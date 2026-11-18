"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { won } from "@/lib/format";

type Pay = { orderId: string; amount: number; orderName: string; clientKey: string; customerName: string; customerEmail: string };

/** 구독 신청: 모의 카드 끝 4자리 → 토스 테스트 결제창 또는 모의 정기 결제. */
export function SubscribeForm({ planCode, price, toss }: { planCode: string; price: number; toss: boolean }) {
  const router = useRouter();
  const [last4, setLast4] = useState("1234");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ pay: Pay | null }>("/api/subscriptions", { plan_code: planCode, card_last4: last4 });
      if (!r.pay) {
        router.push("/my/subscription");
        router.refresh();
        return;
      }
      const { loadTossPayments, ANONYMOUS } = await import("@tosspayments/tosspayments-sdk");
      const tp = await loadTossPayments(r.pay.clientKey);
      await tp.payment({ customerKey: ANONYMOUS }).requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: r.pay.amount },
        orderId: r.pay.orderId,
        orderName: r.pay.orderName,
        successUrl: `${location.origin}/pay/success`,
        failUrl: `${location.origin}/pay/fail`,
        customerEmail: r.pay.customerEmail,
        customerName: r.pay.customerName,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="card-last4" className="label">자동 결제 카드 (모의 카드 끝 4자리)</label>
        <input
          id="card-last4"
          className="field mt-1 font-mono"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          required
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
        />
        <p className="mt-1 text-xs text-slate-500">시연용이라 실제 카드 번호를 받지 않아요. 끝 4자리가 4000이면 결제가 늘 실패하는 시연용 카드예요.</p>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
        <span>기간이 끝나기 하루 전에 같은 금액이 자동 결제되는 것에 동의해요. 해지 예약은 마이페이지에서 언제든 할 수 있어요.</span>
      </label>
      <button type="submit" disabled={busy || !agree || last4.length !== 4} className="btn-primary w-full py-3 text-base">
        {busy ? "결제 진행 중…" : `${won(price)} ${toss ? "결제하고 구독 시작" : "모의 결제하고 구독 시작"}`}
      </button>
      {!toss && <p className="text-center text-xs text-slate-500">시연 환경이라 실제 결제 없이 결제 완료로 처리돼요.</p>}
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
    </form>
  );
}
