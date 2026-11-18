"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/** 토스 결제창에서 돌아오면 서버에 승인을 요청하고 완료 화면으로 보낸다. */
export function PaySuccess({ orderId, paymentKey, amount }: { orderId: string; paymentKey: string; amount: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api<{ order: { code: string } | null; invoice: { id: string } | null }>("/api/payments/confirm", { orderId, paymentKey, amount })
      .then((r) => router.replace(r.order ? `/orders/${r.order.code}/done` : r.invoice ? "/my/subscription" : "/my"))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [orderId, paymentKey, amount, router]);

  if (error) {
    return (
      <div className="text-center">
        <p className="font-semibold text-rose-700">결제를 마치지 못했어요</p>
        <p className="mt-1 text-sm text-slate-600">{error}</p>
        <Link href="/my/orders" className="btn-line mt-4">주문 내역으로</Link>
      </div>
    );
  }
  return <p className="text-center text-slate-600" role="status">결제를 확인하고 있어요. 이 화면을 닫지 말아 주세요.</p>;
}
