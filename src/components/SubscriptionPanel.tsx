"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { won } from "@/lib/format";

type Quote = { kind: "full" | "prorated"; refund: number; used_amount: number; basis_ko: string };

/** 구독 관리 버튼들: 해지 예약·취소, 일시정지·풀기, 카드 바꾸기, 환불 신청. */
export function SubscriptionPanel(props: {
  id: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  pausesLeft: number;
  refundOpen: boolean;
}) {
  const { id, status, cancelAtPeriodEnd, pausesLeft, refundOpen } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [card, setCard] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [reason, setReason] = useState("");

  async function run(path: string, body: unknown, ok: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/subscriptions/${id}/${path}`, body ?? {});
      setNotice(ok);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openRefund() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ quote: Quote }>(`/api/subscriptions/${id}/refund`);
      setQuote(r.quote);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const alive = ["active", "past_due", "paused"].includes(status);
  if (!alive) return null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="font-bold">해지</h2>
        {cancelAtPeriodEnd ? (
          <>
            <p className="mt-1 text-sm text-slate-600">해지를 예약했어요. 이번 기간이 끝나면 결제 없이 구독이 끝나요.</p>
            <button type="button" disabled={busy} onClick={() => run("resume-cancel", {}, "해지 예약을 취소했어요.")} className="btn-line mt-3 px-3 py-1.5 text-sm">
              해지 예약 취소
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">해지를 예약하면 이번 기간이 끝날 때까지 듣고, 그 뒤에는 결제하지 않아요. 진도는 남아요.</p>
            <button type="button" disabled={busy} onClick={() => run("cancel", {}, "해지를 예약했어요.")} className="btn-line mt-3 px-3 py-1.5 text-sm">
              해지 예약
            </button>
          </>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="font-bold">일시정지</h2>
        {status === "paused" ? (
          <>
            <p className="mt-1 text-sm text-slate-600">일시정지 중이에요. 일찍 풀면 남은 날만큼 이번 기간이 당겨져요.</p>
            <button type="button" disabled={busy} onClick={() => run("resume", {}, "구독을 다시 시작했어요.")} className="btn-primary mt-3 px-3 py-1.5 text-sm">
              지금 다시 시작
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">
              멈춘 날만큼 이번 기간이 늘어나요. 1년에 2번, 한 번에 30일까지 할 수 있어요. (남은 횟수 {pausesLeft}번)
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="label">멈출 날 수</span>
                <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} className="field mt-1 w-24" />
              </label>
              <button
                type="button"
                disabled={busy || status !== "active"}
                onClick={() => run("pause", { days }, `구독을 ${days}일 동안 멈췄어요.`)}
                className="btn-line px-3 py-2 text-sm"
              >
                일시정지
              </button>
            </div>
            {status !== "active" && <p className="mt-1 text-xs text-slate-500">결제가 밀린 동안에는 일시정지할 수 없어요.</p>}
          </>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="font-bold">결제 카드 바꾸기</h2>
        <p className="mt-1 text-sm text-slate-600">
          {status === "past_due" ? "결제가 밀려 있어요. 카드를 바꾸면 바로 다시 결제해요." : "다음 자동 결제부터 새 카드로 결제해요."}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="label">모의 카드 끝 4자리</span>
            <input
              inputMode="numeric"
              maxLength={4}
              value={card}
              onChange={(e) => setCard(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="field mt-1 w-28 font-mono"
            />
          </label>
          <button
            type="button"
            disabled={busy || card.length !== 4}
            onClick={() => run("card", { card_last4: card }, status === "past_due" ? "카드를 바꾸고 다시 결제했어요." : "카드를 바꿨어요.")}
            className="btn-line px-3 py-2 text-sm"
          >
            카드 바꾸기
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="font-bold">환불 신청</h2>
        {refundOpen ? (
          <p className="mt-1 text-sm text-slate-600">환불 신청이 들어가 있어요. 담당자가 확인해 승인하면 구독이 끝나고 5일 안에 돌려드려요.</p>
        ) : !quote ? (
          <>
            <p className="mt-1 text-sm text-slate-600">결제 후 7일 이내이고 시청하지 않았으면 전액, 그 밖에는 쓴 만큼 빼고 돌려드려요. 승인되면 구독은 바로 끝나요.</p>
            <button type="button" disabled={busy} onClick={openRefund} className="btn-line mt-3 px-3 py-1.5 text-sm">
              예상 환불액 보기
            </button>
          </>
        ) : (
          <div className="mt-2 space-y-3 text-sm">
            <p>
              예상 환불액 <span className="price text-lg">{won(quote.refund)}</span>
              {quote.kind === "prorated" && <span className="text-slate-500"> (공제 {won(quote.used_amount)})</span>}
            </p>
            <p className="text-slate-600">{quote.basis_ko}</p>
            <label className="block">
              <span className="label">환불 사유</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="field mt-1 w-full" />
            </label>
            <button
              type="button"
              disabled={busy || reason.trim().length < 2}
              onClick={async () => {
                await run("refund", { reason }, "환불 신청을 받았어요.");
                setQuote(null);
              }}
              className="btn-primary px-3 py-1.5 text-sm"
            >
              환불 신청하기
            </button>
          </div>
        )}
      </section>

      {notice && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700" role="status">{notice}</p>}
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
    </div>
  );
}
