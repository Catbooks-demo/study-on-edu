import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Filters, Flash, PageTitle, Pager, Pill, Table, Td, toneOf } from "@/components/admin/ui";
import { ORDER_STATUS_LABEL, dateTimeKo, won } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard, hrefWith, pageOf } from "../guard";

export const metadata = { title: "주문·결제" };

const TAKE = 30;

export default async function Orders({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("orders");
  const q = (sp.q ?? "").trim();
  const status = sp.status && ORDER_STATUS_LABEL[sp.status] ? sp.status : "";
  const page = pageOf(sp.page);
  const where: Prisma.OrderWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? { OR: [{ code: { contains: q.toUpperCase() } }, { user: { email: { contains: q, mode: "insensitive" } } }, { user: { name: { contains: q } } }] }
      : {}),
  };
  const [rows, total, sums] = await Promise.all([
    db.order.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } }, coupon: { select: { code: true } }, items: { include: { course: { select: { title: true } }, bundle: { select: { title: true } } } } },
      orderBy: { created_at: "desc" },
      skip: (page - 1) * TAKE,
      take: TAKE,
    }),
    db.order.count({ where }),
    db.order.aggregate({ where: { ...where, status: { in: ["paid", "partially_refunded", "refunded"] } }, _sum: { payable: true, refunded_amount: true } }),
  ]);
  return (
    <>
      <PageTitle title="주문·결제" sub={`조건에 맞는 주문 ${total.toLocaleString("ko-KR")}건 · 결제 ${won(sums._sum.payable ?? 0)} · 환불 ${won(sums._sum.refunded_amount ?? 0)}`} />
      <Flash sp={sp} />
      <Filters>
        <div><label htmlFor="q" className="label">주문번호·이메일·이름</label><input id="q" name="q" defaultValue={q} className="field w-64" /></div>
        <div>
          <label htmlFor="status" className="label">상태</label>
          <select id="status" name="status" defaultValue={status} className="field">
            <option value="">전체</option>
            {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </Filters>
      <Table head={["주문번호", "주문 시각", "수강생", "항목", "쿠폰", "결제액", "환불", "상태"]} empty={rows.length === 0}>
        {rows.map((o) => (
          <tr key={o.id} className="hover:bg-slate-50">
            <Td><Link href={`/admin/orders/${o.code}`} className="font-medium text-brand-700 hover:underline">{o.code}</Link></Td>
            <Td className="text-slate-500">{dateTimeKo(o.created_at.toISOString())}</Td>
            <Td><Link href={`/admin/students/${o.user.id}`} className="hover:underline">{o.user.name}</Link></Td>
            <Td className="max-w-72 truncate">{o.items.map((i) => i.course?.title ?? i.bundle?.title).join(", ")}</Td>
            <Td className="text-slate-500">{o.coupon?.code ?? "-"}</Td>
            <Td className="tabular-nums">{won(o.payable)}</Td>
            <Td className="tabular-nums text-slate-500">{o.refunded_amount ? won(o.refunded_amount) : "-"}</Td>
            <Td><Pill tone={toneOf(o.status)}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</Pill></Td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / TAKE))} href={(p) => hrefWith("/admin/orders", sp, { page: p })} />
    </>
  );
}
