"use client";

import { useState } from "react";

export const RESOURCE_WARNING = "자료를 받으면 이 강은 본 것으로 계산돼 환불 금액이 줄어요.";

/** 자료 받기 (가짜 PDF). 받기 전에 환불 영향을 확인받는다. */
export function ResourceButton({ lectureId, downloaded }: { lectureId: string; downloaded: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(downloaded);

  async function download() {
    if (!done && !window.confirm(`${RESOURCE_WARNING} 받을까요?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/player/lectures/${lectureId}/download`, { method: "POST", credentials: "same-origin" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message ?? "잠시 후 다시 시도해 주세요.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "studyon-resource.pdf";
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={download} disabled={busy} className="btn-line px-3 py-1.5 text-sm">
        {busy ? "받는 중…" : done ? "자료 다시 받기 (PDF)" : "자료 받기 (PDF)"}
      </button>
      {!done && <p className="mt-1 text-xs text-slate-500">{RESOURCE_WARNING}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
