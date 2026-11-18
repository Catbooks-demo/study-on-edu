"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

const OPTIONS = [
  ["normal", "정상"],
  ["degraded", "가볍게 (추천·자동완성·후기 쓰기 끔)"],
  ["read_only", "읽기 전용 (결제·가입·글쓰기 막음, 수강은 그대로)"],
  ["maintenance", "점검 중 (직원만 들어올 수 있음)"],
] as const;

/** 서비스 모드 바꾸기 (사유 필수). */
export function ModeForm({ current, suggestion }: { current: string; suggestion: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/ops/mode", { mode: f.get("mode"), reason: f.get("reason") });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <fieldset className="space-y-2 text-sm">
        <legend className="label">바꿀 모드</legend>
        {OPTIONS.map(([v, l]) => (
          <label key={v} className="flex items-center gap-2">
            <input type="radio" name="mode" value={v} defaultChecked={v === (suggestion ?? current)} required />
            {l}
            {v === current && <span className="badge">지금</span>}
            {v === suggestion && <span className="badge bg-amber-100 text-amber-800">제안</span>}
          </label>
        ))}
      </fieldset>
      <label className="label" htmlFor="mode-reason">사유 (필수, 작업 기록에 남아요)</label>
      <input id="mode-reason" name="reason" required maxLength={300} className="field" />
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "바꾸는 중…" : "모드 바꾸기"}</button>
    </form>
  );
}
