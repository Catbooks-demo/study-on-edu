"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { won } from "@/lib/format";

/** 결제 버튼: 토스 테스트 키가 있으면 토스 결제창, 없으면 모의 결제. */
export function PayButton({ code, amount, toss, disabled }: { code: string; amount: number; toss: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      if (!toss) {
        await api("/api/payments/mock", { code });
        router.push(`/orders/${code}/done`);
        return;
      }
      const p = await api<{ orderId: string; amount: number; orderName: string; clientKey: string; customerName: string; customerEmail: string }>(
        "/api/payments/prepare",
        { code },
      );
      const { loadTossPayments, ANONYMOUS } = await import("@tosspayments/tosspayments-sdk");
      const tp = await loadTossPayments(p.clientKey);
      const payment = tp.payment({ customerKey: ANONYMOUS });
      await payment.requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: p.amount },
        orderId: p.orderId,
        orderName: p.orderName,
        successUrl: `${location.origin}/pay/success`,
        failUrl: `${location.origin}/pay/fail?order=${encodeURIComponent(code)}`,
        customerEmail: p.customerEmail,
        customerName: p.customerName,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={pay} disabled={busy || disabled} className="btn-primary w-full py-3 text-base">
        {busy ? "결제 진행 중…" : `${won(amount)} ${toss ? "결제하기" : "모의 결제하기"}`}
      </button>
      {!toss && <p className="mt-1 text-center text-xs text-slate-500">시연 환경이라 실제 결제 없이 결제 완료로 처리돼요.</p>}
      {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
    </div>
  );
}
