import { db } from "../db";
import { onJobRun } from "../hooks";

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * 주기 작업 하나를 잠금을 잡고 돌린다. 여러 앱이 떠도 한 번에 하나만 돈다.
 * 트랜잭션 안에서 pg_try_advisory_xact_lock(hashtext('job:'+name))을 잡고 fn을 돌린다. 못 잡으면 null.
 * 돈 작업은 job_runs에 시간·성공 여부를 남기고 onJobRun 지표 훅을 부른다. fn이 실패하면 기록한 뒤 그 오류를 다시 던진다.
 */
export async function withJobLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const started = new Date();
  const outcome = await db.$transaction(
    async (tx): Promise<Outcome<T> | null> => {
      const got = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`job:${name}`})) AS ok`;
      if (!got[0]?.ok) return null;
      try {
        return { ok: true, value: await fn() };
      } catch (error) {
        return { ok: false, error };
      }
    },
    { timeout: 10 * 60_000, maxWait: 30_000 },
  );
  if (!outcome) return null;
  const ms = Date.now() - started.getTime();
  const detail = outcome.ok
    ? { result: typeof outcome.value === "number" ? outcome.value : null }
    : { error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error) };
  await db.jobRun.create({ data: { name, started_at: started, ms, ok: outcome.ok, detail } });
  onJobRun(name, ms, outcome.ok);
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
