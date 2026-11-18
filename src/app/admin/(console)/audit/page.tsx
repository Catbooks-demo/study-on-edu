import type { Prisma } from "@prisma/client";
import { Filters, Flash, PageTitle, Pager, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard, hrefWith, pageOf } from "../guard";

export const metadata = { title: "작업 기록" };

const TAKE = 50;

export default async function Audit({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("audit");
  const page = pageOf(sp.page);
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.action ? { action: { startsWith: sp.action } } : {}),
    ...(sp.actor ? { actor: { contains: sp.actor } } : {}),
    ...(sp.target ? { target: { contains: sp.target } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { created_at: "desc" }, skip: (page - 1) * TAKE, take: TAKE }),
    db.auditLog.count({ where }),
  ]);
  const staffIds = [...new Set(rows.map((r) => r.actor).filter((a) => a.startsWith("staff:")).map((a) => a.slice(6)))];
  const staff = await db.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } });
  const nameOf = new Map(staff.map((s) => [`staff:${s.id}`, s.name]));
  return (
    <>
      <PageTitle title="작업 기록" sub="직원·강사·API 키·주기 작업이 바꾼 것을 모두 남겨요. 지우거나 고칠 수 없어요." />
      <Flash sp={sp} />
      <Filters>
        <div><label htmlFor="action" className="label">작업 (앞부분)</label><input id="action" name="action" defaultValue={sp.action ?? ""} placeholder="refund. · course." className="field w-40" /></div>
        <div><label htmlFor="actor" className="label">누가</label><input id="actor" name="actor" defaultValue={sp.actor ?? ""} placeholder="staff: · api:" className="field w-40" /></div>
        <div><label htmlFor="target" className="label">대상</label><input id="target" name="target" defaultValue={sp.target ?? ""} className="field w-48" /></div>
      </Filters>
      <Table head={["시각", "누가", "작업", "대상", "내용"]} empty={rows.length === 0}>
        {rows.map((a) => (
          <tr key={a.id}>
            <Td className="text-slate-500">{dateTimeKo(a.created_at.toISOString())}</Td>
            <Td>{nameOf.get(a.actor) ?? a.actor}</Td>
            <Td className="font-mono text-xs">{a.action}</Td>
            <Td className="font-mono text-xs">{a.target}</Td>
            <Td className="max-w-md truncate font-mono text-xs text-slate-500">{a.detail ? JSON.stringify(a.detail) : ""}</Td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / TAKE))} href={(p) => hrefWith("/admin/audit", sp, { page: p })} />
    </>
  );
}
