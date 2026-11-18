import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Dl, Flash, PageTitle, Pill, Table, Td, toneOf } from "@/components/admin/ui";
import { ORDER_STATUS_LABEL, REFUND_STATUS_LABEL, dateTimeKo, won } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard } from "../../guard";

export const metadata = { title: "주문 상세" };

const PAY_STATUS: Record<string, string> = { pending: "대기", approved: "승인", failed: "실패", cancelled: "취소" };

export default async function OrderDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: SP }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  await guard("orders");
  const o = await db.order.findUnique({
    where: { code },
    include: {
      user: true,
      coupon: true,
      items: { include: { course: true, bundle: true, refunds: { orderBy: { created_at: "desc" } } }, orderBy: { created_at: "asc" } },
      payments: { orderBy: { created_at: "asc" } },
    },
  });
  if (!o) notFound();
  return (
    <>
      <PageTitle title={`주문 ${o.code}`} sub={`${o.user.name} · ${o.user.email}`}>
        <Link href="/admin/orders" className="text-sm text-slate-500 hover:underline">← 주문 목록</Link>
      </PageTitle>
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <Card title="주문">
          <Dl
            rows={[
              ["상태", <Pill key="s" tone={toneOf(o.status)}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</Pill>],
              ["수강생", <Link key="u" href={`/admin/students/${o.user.id}`} className="text-brand-700 hover:underline">{o.user.name}</Link>],
              ["주문", dateTimeKo(o.created_at.toISOString())],
              ["결제", o.paid_at ? dateTimeKo(o.paid_at.toISOString()) : "-"],
              ["정가 합", won(o.list_total)],
              ["할인", won(o.discount_total)],
              ["쿠폰", o.coupon ? `${o.coupon.code} −${won(o.coupon_discount)}${o.coupon.referral ? " (강사 추천)" : ""}` : "-"],
              ["결제액", <b key="p" className="tabular-nums">{won(o.payable)}</b>],
              ["환불", won(o.refunded_amount)],
            ]}
          />
        </Card>
        <div className="space-y-4">
          <Card title="항목">
            <Table head={["상품", "정가", "판매가", "쿠폰 몫", "낸 금액", "상태", "환불"]}>
              {o.items.map((i) => (
                <tr key={i.id}>
                  <Td className="max-w-72 truncate">{i.kind === "bundle" ? "[패키지] " : ""}{i.course?.title ?? i.bundle?.title}</Td>
                  <Td className="tabular-nums">{won(i.list_price)}</Td>
                  <Td className="tabular-nums">{won(i.unit_price)}</Td>
                  <Td className="tabular-nums">{i.coupon_share ? `−${won(i.coupon_share)}` : "-"}</Td>
                  <Td className="tabular-nums font-medium">{won(i.paid_amount)}</Td>
                  <Td><Pill tone={toneOf(i.status)}>{i.status === "refunded" ? "환불됨" : "유효"}</Pill></Td>
                  <Td>
                    {i.refunds[0] ? (
                      <Link href={`/admin/refunds/${i.refunds[0].id}`} className="text-brand-700 hover:underline">
                        {REFUND_STATUS_LABEL[i.refunds[0].status]} {won(i.refunds[0].amount)}
                      </Link>
                    ) : "-"}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="결제 기록">
            <Table head={["시각", "종류", "수단", "금액", "상태", "결제사 번호"]} empty={o.payments.length === 0}>
              {o.payments.map((p) => (
                <tr key={p.id}>
                  <Td>{dateTimeKo((p.approved_at ?? p.created_at).toISOString())}</Td>
                  <Td>{p.kind === "refund" ? "환불" : "결제"}</Td>
                  <Td>{p.method === "mock" ? "모의 결제" : "토스(테스트)"}</Td>
                  <Td className="tabular-nums">{p.kind === "refund" ? "−" : ""}{won(p.amount)}</Td>
                  <Td><Pill tone={toneOf(p.status)}>{PAY_STATUS[p.status] ?? p.status}</Pill>{p.failure_reason ? <span className="ml-2 text-xs text-rose-600">{p.failure_reason}</span> : null}</Td>
                  <Td className="font-mono text-xs text-slate-500">{p.toss_order_id ?? "-"}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
