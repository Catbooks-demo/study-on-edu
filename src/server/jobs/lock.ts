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

/**
 * 가상 데이터 되채우기(scripts/gen-synthetic.ts)가 도는 동안 잡고 있는 잠금 이름.
 * 되채우기는 지난 시각으로 주문·구독을 넣으므로, 그동안 앱의 주기 작업이 지금 시각으로 돌면
 * 막 만든 주문을 결제 기한 초과로 취소하거나 구독을 갱신해 버린다. 그래서 앱은 이 잠금이 잡혀 있으면 쉰다.
 */
export const SYNTH_BACKFILL_LOCK = "synth:backfill";

/** 되채우기가 지금 돌고 있는지 (그 잠금을 다른 연결이 잡고 있으면 true). */
export async function backfillRunning(): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock_shared(hashtext(${SYNTH_BACKFILL_LOCK})) AS ok`;
    return !r[0]?.ok;
  });
}
