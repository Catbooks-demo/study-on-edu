import type { Prisma } from "@prisma/client";
import { Filters, Flash, PageTitle, Pager, Pill, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard, hrefWith, pageOf } from "../guard";

export const metadata = { title: "회원 메시지함" };

const TAKE = 50;
const SOURCE_KO: Record<string, string> = { site: "사이트", admin: "직원", api: "외부 API" };

/** 회원 메시지함에 들어간 안내 기록 (쿠폰 도착·외부 시스템 안내). */
export default async function Inbox({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("support");
  const page = pageOf(sp.page);
  const where: Prisma.InboxMessageWhereInput = {
    ...(sp.to ? { user: { email: { contains: sp.to, mode: "insensitive" } } } : {}),
    ...(sp.kind ? { kind: sp.kind } : {}),
    ...(sp.source ? { source: sp.source } : {}),
  };
  const [rows, total, kinds] = await Promise.all([
    db.inboxMessage.findMany({
      where,
      include: { user: { select: { email: true } }, coupon: { select: { code: true } } },
      orderBy: { created_at: "desc" },
      skip: (page - 1) * TAKE,
      take: TAKE,
    }),
    db.inboxMessage.count({ where }),
    db.inboxMessage.groupBy({ by: ["kind"], _count: { _all: true }, orderBy: { kind: "asc" } }),
  ]);
  return (
    <>
      <PageTitle title="회원 메시지함" sub="회원이 마이페이지 메시지함에서 보는 안내예요. 쿠폰함 발급 안내와 외부 시스템(API)이 보낸 안내가 여기에 남아요." />
      <Flash sp={sp} />
      <Filters>
        <div><label htmlFor="to" className="label">회원 이메일</label><input id="to" name="to" defaultValue={sp.to ?? ""} className="field w-56" /></div>
        <div>
          <label htmlFor="kind" className="label">종류</label>
          <select id="kind" name="kind" defaultValue={sp.kind ?? ""} className="field">
            <option value="">전체</option>
            {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.kind} ({k._count._all})</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="source" className="label">보낸 곳</label>
          <select id="source" name="source" defaultValue={sp.source ?? ""} className="field">
            <option value="">전체</option>
            {Object.entries(SOURCE_KO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </Filters>
      <Table head={["보낸 때", "회원", "종류", "제목·내용", "보낸 곳", "읽음"]} empty={rows.length === 0}>
        {rows.map((m) => (
          <tr key={m.id}>
            <Td className="text-slate-500">{dateTimeKo(m.created_at.toISOString())}</Td>
            <Td>{m.user.email}</Td>
            <Td className="font-mono text-xs">{m.kind}{m.coupon ? <div className="text-slate-400">{m.coupon.code}</div> : null}</Td>
            <Td className="max-w-xl whitespace-normal"><p className="font-medium">{m.title}</p><p className="text-slate-600">{m.body}</p></Td>
            <Td>{SOURCE_KO[m.source] ?? m.source}</Td>
            <Td>{m.read_at ? <Pill tone="green">읽음</Pill> : <Pill tone="gray">안 읽음</Pill>}</Td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / TAKE))} href={(p) => hrefWith("/admin/inbox", sp, { page: p })} />
    </>
  );
}
