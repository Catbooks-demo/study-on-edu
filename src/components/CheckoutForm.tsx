"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { won } from "@/lib/format";
import { PayButton } from "./PayButton";

export type CheckoutOrder = {
  code: string;
  list_total: number;
  discount_total: number;
  coupon_code: string | null;
  coupon_discount: number;
  payable: number;
  items: { id: string; title: string; kind: string; unit_price: number; coupon_share: number; paid_amount: number }[];
};

/** 주문서: 쿠폰 넣기·빼기, 가격 내역, 환불 규정 동의, 결제. */
export function CheckoutForm({ order, toss }: { order: CheckoutOrder; toss: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState(order.coupon_code ?? "");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setCoupon(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/orders/${order.code}/coupon`, { coupon_code: next });
      if (next === null) setCode("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <h2 className="font-bold">주문 강의</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {order.items.map((it) => (
              <li key={it.id} className="flex justify-between gap-3 py-2">
                <span className="min-w-0">
                  {it.kind === "bundle" && <span className="badge mr-1">패키지</span>}
                  {it.title}
                </span>
                <span className="shrink-0 text-right">
                  <span className="price">{won(it.paid_amount)}</span>
                  {it.coupon_share > 0 && <span className="block text-xs text-slate-400">쿠폰 −{won(it.coupon_share)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <h2 className="font-bold">쿠폰</h2>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) setCoupon(code.trim());
            }}
          >
            <label htmlFor="coupon" className="sr-only">쿠폰 번호</label>
            <input id="coupon" className="field flex-1 uppercase" placeholder="쿠폰 번호" maxLength={40} value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
            <button className="btn-line shrink-0" disabled={busy || !code.trim()}>적용</button>
            {order.coupon_code && (
              <button type="button" className="shrink-0 text-sm text-slate-500 underline" onClick={() => setCoupon(null)} disabled={busy}>빼기</button>
            )}
          </form>
          {order.coupon_code && <p className="mt-2 text-sm text-brand-700" role="status">{order.coupon_code} 쿠폰으로 {won(order.coupon_discount)} 할인돼요.</p>}
          {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
        </section>
      </div>
      <aside className="h-fit rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">정가 합계</dt><dd>{won(order.list_total)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">할인</dt><dd className="text-rose-500">−{won(order.discount_total)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">쿠폰</dt><dd className="text-rose-500">−{won(order.coupon_discount)}</dd></div>
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold">
            <dt>결제 금액</dt>
            <dd className="price" data-testid="checkout-payable">{won(order.payable)}</dd>
          </div>
        </dl>
        <label className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            [필수] <Link href="/terms/refund" target="_blank" className="underline">환불 규정</Link>을 확인했어요. 결제 후 7일 이내·진도 5% 미만이면 전액, 그 뒤에는 수강한 만큼 빼고 돌려받아요.
          </span>
        </label>
        <div className="mt-4">
          <PayButton code={order.code} amount={order.payable} toss={toss} disabled={!agreed || busy} />
          {!agreed && <p className="mt-1 text-center text-xs text-slate-500">환불 규정을 확인하고 체크해 주세요.</p>}
        </div>
      </aside>
    </div>
  );
}
