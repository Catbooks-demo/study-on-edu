import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Flash, PageTitle, Pager, Pill, Table, Tabs, Td, toneOf } from "@/components/admin/ui";
import { REFUND_STATUS_LABEL, dateTimeKo, won } from "@/lib/format";
import { refundDueAt, refundOverdue } from "@/rules/deadlines";
import { db } from "@/server/db";
import { type SP, guard, hrefWith, pageOf } from "../guard";

export const metadata = { title: "환불" };

const STATUSES = ["requested", "approved", "done", "rejected"] as const;
const TAKE = 30;

export default async function Refunds({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("refunds");
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status! : "";
  const page = pageOf(sp.page);
  const where: Prisma.RefundWhereInput = status ? { status } : {};
  const [rows, total] = await Promise.all([
    db.refund.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        order_item: { include: { order: { select: { code: true } }, course: { select: { title: true } }, bundle: { select: { title: true } } } },
        invoice: { include: { subscription: { include: { plan: true } } } },
      },
      orderBy: { created_at: status === "requested" ? "asc" : "desc" },
      skip: (page - 1) * TAKE,
      take: TAKE,
    }),
    db.refund.count({ where }),
  ]);
  const now = new Date();
  return (
    <>
      <PageTitle title="환불" sub="신청을 열어 계산기로 진도 방식·경과일 방식을 비교한 뒤 승인하거나 거절해요. 승인하면 5일 안에 돌려드려야 해요." />
      <Flash sp={sp} />
      <Tabs
        current={status || "all"}
        items={[
          { key: "requested", label: "처리 대기", href: "/admin/refunds?status=requested" },
          { key: "approved", label: "환불 처리 중", href: "/admin/refunds?status=approved" },
          { key: "done", label: "환불 완료", href: "/admin/refunds?status=done" },
          { key: "rejected", label: "거절", href: "/admin/refunds?status=rejected" },
          { key: "all", label: "전체", href: "/admin/refunds" },
        ]}
      />
      <Table head={["신청", "주문", "대상", "수강생", "계산액", "환불액", "상태", "처리 기한"]} empty={rows.length === 0}>
        {rows.map((r) => {
          const overdue = r.approved_at ? refundOverdue(r.approved_at, r.done_at, now) : false;
          return (
            <tr key={r.id} className="hover:bg-slate-50">
              <Td className="text-slate-500">{dateTimeKo(r.created_at.toISOString())}</Td>
              <Td>
                <Link href={`/admin/refunds/${r.id}`} className="font-medium text-brand-700 underline-offset-2 hover:underline">
                  {r.order_item ? r.order_item.order.code : `구독 ${r.invoice?.subscription.plan.name ?? ""}`}
                </Link>
              </Td>
              <Td className="max-w-64 truncate">{r.order_item ? (r.order_item.course?.title ?? r.order_item.bundle?.title) : "구독 청구"}</Td>
              <Td><Link href={`/admin/students/${r.user.id}`} className="hover:underline">{r.user.name}</Link></Td>
              <Td className="tabular-nums text-slate-500">{won(r.calc_amount)}</Td>
              <Td className="tabular-nums">{won(r.amount)}</Td>
              <Td><Pill tone={toneOf(r.status)}>{REFUND_STATUS_LABEL[r.status] ?? r.status}</Pill></Td>
              <Td>{r.approved_at && r.status !== "done" ? <span className={overdue ? "font-semibold text-rose-600" : "text-slate-500"}>{dateTimeKo(refundDueAt(r.approved_at).toISOString())}{overdue ? " 지남" : ""}</span> : "-"}</Td>
            </tr>
          );
        })}
      </Table>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / TAKE))} href={(p) => hrefWith("/admin/refunds", sp, { page: p })} />
    </>
  );
}
