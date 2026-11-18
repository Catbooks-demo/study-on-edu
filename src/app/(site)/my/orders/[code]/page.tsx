import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RefundPanel } from "@/components/RefundPanel";
import { ORDER_STATUS_LABEL, REFUND_STATUS_LABEL, dateKo, dateTimeKo, won } from "@/lib/format";
import { kstDate } from "@/rules/time";
import { currentUser } from "@/server/auth/current";
import { HttpError } from "@/server/http";
import { getOrderForUser, orderView } from "@/server/orders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "주문 상세" };

export default async function MyOrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/my/orders/${encodeURIComponent(code)}`);
  const order = await getOrderForUser(user.id, code).catch((e) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const v = orderView(order);
  const refundable = v.status === "paid" || v.status === "partially_refunded";
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm"><Link href="/my/orders" className="text-brand-600 hover:underline">주문·환불</Link></p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-extrabold">{v.code}</h1>
        <span className="badge">{ORDER_STATUS_LABEL[v.status] ?? v.status}</span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {v.paid_at ? `${dateTimeKo(v.paid_at)} 결제` : `${dateTimeKo(v.created_at)} 주문`}
        {v.status === "pending" && (
          <>
            {" · "}
            <Link href={`/checkout/${v.code}`} className="font-semibold text-brand-600 underline">결제하러 가기</Link>
          </>
        )}
      </p>

      <ul className="mt-6 space-y-3">
        {v.items.map((it) => {
          const open = it.refund && (it.refund.status === "requested" || it.refund.status === "approved");
          return (
            <li key={it.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-brand-600">{it.kind === "bundle" ? "패키지" : it.instructor_name}</p>
                  <Link href={it.kind === "bundle" ? `/bundles/${it.code}` : `/courses/${it.code}`} className="font-semibold hover:text-brand-700">{it.title}</Link>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <span className="price" data-testid="item-paid">{won(it.paid_amount)}</span>
                  {it.coupon_share > 0 && <span className="block text-xs text-slate-400">쿠폰 −{won(it.coupon_share)}</span>}
                </div>
              </div>
              {it.refund && (
                <p className="mt-2 text-sm text-slate-600">
                  {REFUND_STATUS_LABEL[it.refund.status] ?? it.refund.status}
                  {it.refund.status !== "rejected" && ` · ${won(it.refund.amount)}`}
                  {" · "}
                  {dateKo(kstDate(new Date(it.refund.created_at)))} 신청
                </p>
              )}
              {refundable && it.status === "active" && !open && <RefundPanel itemId={it.id} title={it.title} />}
            </li>
          );
        })}
      </ul>

      <dl className="mt-6 space-y-1.5 rounded-2xl bg-white p-5 text-sm ring-1 ring-slate-200">
        <div className="flex justify-between"><dt className="text-slate-500">정가 합계</dt><dd>{won(v.list_total)}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-500">할인</dt><dd>−{won(v.discount_total)}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-500">쿠폰{v.coupon_code ? ` (${v.coupon_code})` : ""}</dt><dd>−{won(v.coupon_discount)}</dd></div>
        <div className="flex justify-between border-t border-slate-100 pt-2 font-bold"><dt>결제 금액</dt><dd className="price">{won(v.payable)}</dd></div>
        {v.refunded_amount > 0 && <div className="flex justify-between text-rose-600"><dt>환불한 금액</dt><dd>{won(v.refunded_amount)}</dd></div>}
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        환불은 <Link href="/terms/refund" className="underline">환불 규정</Link>대로 계산해요. 패키지는 패키지 전체로, 쿠폰을 썼으면 실제 낸 금액으로 계산해요.
      </p>
    </div>
  );
}
