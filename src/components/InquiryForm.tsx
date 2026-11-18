"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

const CATEGORIES = [
  ["payment", "결제"],
  ["refund", "환불"],
  ["player", "재생·기기"],
  ["subscription", "구독"],
  ["live", "라이브"],
  ["etc", "기타"],
] as const;

/** 1:1 문의 쓰기. 보내면 내 문의 목록으로 간다. */
export function InquiryForm() {
  const router = useRouter();
  const [f, setF] = useState({ category: "player", title: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/inquiries", f);
      router.push("/my/inquiries");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
      <div>
        <label htmlFor="inq-cat" className="label">문의 종류</label>
        <select id="inq-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="field">
          {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="inq-title" className="label">제목</label>
        <input id="inq-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={100} required className="field" />
      </div>
      <div>
        <label htmlFor="inq-body" className="label">내용</label>
        <textarea id="inq-body" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={3000} rows={6} required className="field" placeholder="주문번호나 강의 이름을 함께 적어 주시면 더 빨리 도와드릴 수 있어요." />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="btn-primary px-4 py-2">{busy ? "보내는 중…" : "문의 보내기"}</button>
    </form>
  );
}
