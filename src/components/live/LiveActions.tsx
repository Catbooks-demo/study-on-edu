"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

/** 라이브 상세의 버튼: 로그인 → 예약 → (시작 10분 전부터) 입장. */
export function LiveActions(props: { id: string; loggedIn: boolean; reserved: boolean; full: boolean; open: boolean; closed: boolean }) {
  const { id, loggedIn, reserved, full, open, closed } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(path: "reserve" | "enter") {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ room_url?: string }>(`/api/live/${id}/${path}`, {});
      if (path === "enter" && r.room_url) router.push(r.room_url);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (closed) return <p className="text-sm text-slate-500">끝난 라이브예요.</p>;
  if (!loggedIn) {
    return <Link href={`/login?next=${encodeURIComponent(`/live/${id}`)}`} className="btn-primary w-full">로그인하고 예약하기</Link>;
  }
  return (
    <div className="space-y-2">
      {!reserved ? (
        <button type="button" onClick={() => act("reserve")} disabled={busy || full} className="btn-primary w-full">
          {full ? "예약이 다 찼어요" : busy ? "예약하는 중…" : "자리 예약하기"}
        </button>
      ) : (
        <>
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-center text-sm text-brand-700">예약했어요.</p>
          <button type="button" onClick={() => act("enter")} disabled={busy || !open} className="btn-accent w-full">
            {open ? (busy ? "들어가는 중…" : "라이브 입장하기") : "시작 10분 전부터 입장할 수 있어요"}
          </button>
        </>
      )}
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
    </div>
  );
}
