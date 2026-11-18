"use client";

import { useEffect, useRef, useState } from "react";

type Poll = { ticket_id: string; status: "waiting" | "admitted" | "expired"; ahead: number; eta_sec: number };

const etaText = (s: number) => (s < 60 ? `약 ${Math.max(1, s)}초` : `약 ${Math.ceil(s / 60)}분`);

/**
 * 가상 대기실: 순번표가 없으면 줄을 서고, 3초마다 차례를 확인해 입장되면 next로 보낸다.
 * 입장 쿠키는 서버가 붙인다(HttpOnly). 화면을 새로 읽어야 레이아웃 문이 쿠키를 보므로 전체 이동한다.
 */
export function WaitingRoom({ target, ticket, next, text }: { target: string | null; ticket: string | null; next: string; text: string }) {
  const [state, setState] = useState<Poll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useRef<string | null>(ticket);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = () => window.location.replace(next);

    async function tick() {
      try {
        let res: Response;
        if (!id.current) {
          res = await fetch("/api/queue/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: target ?? "site" }),
            credentials: "same-origin",
          });
        } else {
          res = await fetch(`/api/queue/${encodeURIComponent(id.current)}`, { credentials: "same-origin" });
        }
        const data = await res.json().catch(() => ({}));
        if (stop) return;
        if (res.status === 409 && data?.error?.code === "QUEUE_OFF") return go();
        if (res.status === 404) {
          id.current = null; // 표가 없어졌으면 다시 줄을 선다
        } else if (!res.ok) {
          setError(data?.error?.message ?? "잠시 후 다시 시도해 주세요.");
        } else {
          const p = data as Poll;
          id.current = p.ticket_id;
          setState(p);
          setError(null);
          if (p.status === "admitted") return go();
          if (p.status === "expired") id.current = null;
        }
      } catch {
        setError("연결이 잠깐 끊겼어요. 다시 시도하고 있어요.");
      }
      if (!stop) timer = setTimeout(tick, 3000);
    }
    tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [target, next]);

  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center" data-testid="waiting-room">
      <h1 className="text-2xl font-extrabold">잠시만 기다려 주세요</h1>
      <p className="mt-3 text-slate-700">{text}</p>
      <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-slate-200" aria-live="polite">
        {state?.status === "waiting" ? (
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-slate-500">내 앞에</dt>
              <dd className="mt-1 text-3xl font-bold tabular-nums" data-testid="queue-ahead">{state.ahead.toLocaleString("ko-KR")}명</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">예상 대기</dt>
              <dd className="mt-1 text-3xl font-bold">{etaText(state.eta_sec)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-slate-500">순서를 확인하고 있어요…</p>
        )}
        <p className="mt-4 text-xs text-slate-400">3초마다 자동으로 새로고침해요. 차례가 되면 바로 넘어가요.</p>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
