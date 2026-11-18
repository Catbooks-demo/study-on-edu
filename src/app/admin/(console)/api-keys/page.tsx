import { cookies } from "next/headers";
import { apiKeyIssueAction, apiKeyRevokeAction } from "@/app/admin/actions";
import { ActionButton, Card, Flash, PageTitle, Pill, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { NEW_KEY_COOKIE, SCOPES, SCOPE_KO, type Scope } from "@/server/apikeys";
import { db } from "@/server/db";
import { type SP, guard } from "../guard";

export const metadata = { title: "API 키" };

export default async function ApiKeys({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("api_keys");
  const fresh = (await cookies()).get(NEW_KEY_COOKIE)?.value;
  const rows = await db.apiKey.findMany({ orderBy: { created_at: "desc" } });
  const staff = await db.staff.findMany({ where: { id: { in: rows.map((r) => r.created_by).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  return (
    <>
      <PageTitle title="API 키" sub="외부 시스템이 /api/v1과 /metrics를 부를 때 쓰는 키예요. 키 원문은 만들 때 한 번만 보여 주고 저장하지 않아요." />
      <Flash sp={sp} />
      {fresh && (
        <div className="mb-4 rounded-xl border border-lemon-500 bg-lemon-300/20 p-4" role="status">
          <p className="text-sm font-semibold">새 키예요. 지금 복사해 두세요. 이 화면을 벗어나면 다시 볼 수 없어요.</p>
          <code className="mt-2 block break-all rounded bg-white p-3 font-mono text-sm" data-testid="new-api-key">{fresh}</code>
          <p className="mt-2 text-xs text-slate-600">요청 헤더: <code>Authorization: Bearer {fresh.slice(0, 8)}…</code> · 키당 분당 600회</p>
        </div>
      )}
      <Table head={["이름", "앞자리", "범위", "마지막 사용", "만든 사람", "만든 때", "상태", ""]} empty={rows.length === 0}>
        {rows.map((k) => (
          <tr key={k.id} className={k.revoked_at ? "text-slate-400" : ""}>
            <Td className="font-medium">{k.name}</Td>
            <Td className="font-mono text-xs">{k.prefix}…</Td>
            <Td className="space-x-1">{k.scopes.map((s) => <Pill key={s} tone={s === "read_pii" || s === "write" ? "amber" : "gray"}>{s}</Pill>)}</Td>
            <Td>{k.last_used_at ? dateTimeKo(k.last_used_at.toISOString()) : "-"}</Td>
            <Td>{(k.created_by && nameOf.get(k.created_by)) ?? "-"}</Td>
            <Td>{dateTimeKo(k.created_at.toISOString())}</Td>
            <Td>{k.revoked_at ? <Pill tone="red">폐기 {dateTimeKo(k.revoked_at.toISOString())}</Pill> : <Pill tone="green">사용 중</Pill>}</Td>
            <Td>{!k.revoked_at && <ActionButton action={apiKeyRevokeAction} fields={{ id: k.id }} label="폐기" tone="danger" confirm={`「${k.name}」 키를 폐기할까요? 이 키를 쓰는 시스템은 바로 401을 받아요.`} />}</Td>
          </tr>
        ))}
      </Table>
      <Card title="새 키 만들기" className="mt-6">
        <form action={apiKeyIssueAction} className="space-y-3 text-sm">
          <div><label htmlFor="name" className="label">이름 (어느 시스템이 쓰는지)</label><input id="name" name="name" required maxLength={50} className="field max-w-md" placeholder="예: 데이터 분석 수집기" /></div>
          <fieldset>
            <legend className="label">범위</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {SCOPES.map((s: Scope) => (
                <label key={s} className="flex items-center gap-2"><input type="checkbox" name="scopes" value={s} defaultChecked={s === "read"} /> <code className="text-xs">{s}</code> {SCOPE_KO[s]}</label>
              ))}
            </div>
          </fieldset>
          <button className="btn-primary">만들기</button>
        </form>
      </Card>
    </>
  );
}
