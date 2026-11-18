import type { Prisma } from "@prisma/client";
import { Filters, Flash, PageTitle, Pager, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard, hrefWith, pageOf } from "../guard";

export const metadata = { title: "보낸 편지함" };

const TAKE = 50;

export default async function Messages({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("support");
  const page = pageOf(sp.page);
  const where: Prisma.MessageWhereInput = {
    ...(sp.to ? { to: { contains: sp.to, mode: "insensitive" } } : {}),
    ...(sp.kind ? { kind: sp.kind } : {}),
  };
  const [rows, total, kinds] = await Promise.all([
    db.message.findMany({ where, orderBy: { created_at: "desc" }, skip: (page - 1) * TAKE, take: TAKE }),
    db.message.count({ where }),
    db.message.groupBy({ by: ["kind"], _count: { _all: true }, orderBy: { kind: "asc" } }),
  ]);
  return (
    <>
      <PageTitle title="보낸 편지함" sub="시연용이라 실제 메일·문자는 보내지 않고 여기에만 남겨요." />
      <Flash sp={sp} />
      <Filters>
        <div><label htmlFor="to" className="label">받는 사람</label><input id="to" name="to" defaultValue={sp.to ?? ""} className="field w-56" /></div>
        <div>
          <label htmlFor="kind" className="label">종류</label>
          <select id="kind" name="kind" defaultValue={sp.kind ?? ""} className="field">
            <option value="">전체</option>
            {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.kind} ({k._count._all})</option>)}
          </select>
        </div>
      </Filters>
      <Table head={["보낸 때", "받는 사람", "종류", "제목·내용"]} empty={rows.length === 0}>
        {rows.map((m) => (
          <tr key={m.id}>
            <Td className="text-slate-500">{dateTimeKo(m.created_at.toISOString())}</Td>
            <Td>{m.to}<div className="text-xs text-slate-400">{m.channel === "sms" ? "문자" : "메일"}</div></Td>
            <Td className="font-mono text-xs">{m.kind}</Td>
            <Td className="max-w-xl whitespace-normal"><p className="font-medium">{m.subject}</p><p className="text-slate-600">{m.body}</p></Td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / TAKE))} href={(p) => hrefWith("/admin/messages", sp, { page: p })} />
    </>
  );
}
