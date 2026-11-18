"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { pct1, won } from "@/lib/format";

type Quote = {
  kind: "full" | "prorated";
  elapsed_days: number;
  progress_ratio: number;
  period_ratio: number | null;
  used_amount: number;
  refund: number;
  basis_ko: string;
};

/** 환불 신청: 미리 보기(경과일·진도·공제 근거) → 사유 입력 → 신청. */
export function RefundPanel({ itemId, title }: { itemId: string; title: string }) {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ quote: Quote }>(`/api/refunds/preview?item=${encodeURIComponent(itemId)}`);
      setQuote(r.quote);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/refunds", { order_item_id: itemId, reason });
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (done) {
    return <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700" role="status">환불 신청을 받았어요. 담당자가 확인해 승인하면 5일 안에 돌려드려요.</p>;
  }
  if (!quote) {
    return (
      <div className="mt-3">
        <button type="button" onClick={open} disabled={busy} className="btn-line px-3 py-1.5 text-sm" title={`${title} 환불 신청`}>
          {busy ? "계산하는 중…" : "환불 신청"}
        </button>
        {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-slate-500">결제 후</dt>
        <dd>{quote.elapsed_days}일</dd>
        <dt className="text-slate-500">진도율</dt>
        <dd>{pct1(quote.progress_ratio)}</dd>
        {quote.period_ratio !== null && (
          <>
            <dt className="text-slate-500">기간 비율</dt>
            <dd>{pct1(quote.period_ratio)}</dd>
          </>
        )}
        <dt className="text-slate-500">계산 근거</dt>
        <dd>{quote.basis_ko}</dd>
      </dl>
      <p className="mt-3 flex items-baseline justify-between border-t border-slate-200 pt-3">
        <span className="font-semibold">예상 환불액</span>
        <span className="price text-lg" data-testid="refund-estimate">{won(quote.refund)}</span>
      </p>
      <p className="mt-1 text-xs text-slate-500">승인하는 날 다시 계산해요. 그 사이 더 들으면 금액이 줄 수 있어요.</p>
      <label htmlFor={`reason-${itemId}`} className="label mt-3">환불 사유</label>
      <textarea id={`reason-${itemId}`} className="field min-h-20" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 생각한 내용과 달라요" />
      {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={submit} disabled={busy || reason.trim().length < 2} className="btn-primary px-4 py-2">{busy ? "신청하는 중…" : "신청하기"}</button>
        <button type="button" onClick={() => setQuote(null)} className="text-sm text-slate-500 underline">닫기</button>
      </div>
    </div>
  );
}
