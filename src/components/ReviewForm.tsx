"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

/** 수강평 쓰기 (진도율 40% 이상, 강의당 하나). */
export function ReviewForm({ courseCode }: { courseCode: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/reviews", { course_code: courseCode, rating, body });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <fieldset>
        <legend className="label">별점</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-pressed={rating === n} aria-label={`${n}점`} onClick={() => setRating(n)} className={`text-2xl ${n <= rating ? "text-lemon-500" : "text-slate-300"}`}>★</button>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="rv-body" className="label">수강평 (10자 이상)</label>
        <textarea id="rv-body" value={body} onChange={(e) => setBody(e.target.value)} minLength={10} maxLength={1000} rows={4} required className="field" />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="btn-primary px-4 py-2 text-sm">{busy ? "올리는 중…" : "수강평 올리기"}</button>
    </form>
  );
}
