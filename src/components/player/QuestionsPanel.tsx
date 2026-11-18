"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dateTimeKo } from "@/lib/format";

type QuestionRow = {
  id: string;
  title: string;
  body: string;
  author: string;
  mine: boolean;
  created_at: string;
  answered_at: string | null;
  answers: { id: string; author: string; body: string; created_at: string }[];
};

/** 이 강의 질문: 목록과 질문 쓰기. 답변은 강사·운영팀이 단다(7일 안에). */
export function QuestionsPanel({ lectureId }: { lectureId: string }) {
  const [items, setItems] = useState<QuestionRow[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const fetchItems = useCallback(async (): Promise<QuestionRow[]> => {
    try {
      return (await api<{ questions: QuestionRow[] }>(`/api/questions?lecture_id=${encodeURIComponent(lectureId)}`)).questions;
    } catch {
      return [];
    }
  }, [lectureId]);

  useEffect(() => {
    let alive = true;
    fetchItems().then((q) => {
      if (alive) setItems(q);
    });
    return () => {
      alive = false;
    };
  }, [fetchItems]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/questions", { lecture_id: lectureId, title, body });
      setTitle("");
      setBody("");
      setSent(true);
      setItems(await fetchItems());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={ask} className="space-y-2">
        <div>
          <label htmlFor="q-title" className="label">질문 제목</label>
          <input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required className="field" />
        </div>
        <div>
          <label htmlFor="q-body" className="label">질문 내용</label>
          <textarea id="q-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} rows={4} required className="field" />
        </div>
        <button disabled={busy} className="btn-primary px-3 py-1.5 text-sm">{busy ? "올리는 중…" : "질문 올리기"}</button>
        {sent && <p role="status" className="text-xs text-brand-700">질문을 올렸어요. 강사가 7일 안에 답해 드려요.</p>}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </form>
      <ul className="mt-5 space-y-3">
        {items.length === 0 && <li className="text-sm text-slate-500">이 강에 올라온 질문이 없어요.</li>}
        {items.map((q) => (
          <li key={q.id} className="rounded-xl bg-slate-50 p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{q.title}</span>
              <span className={`badge ${q.answered_at ? "bg-brand-50 text-brand-700 ring-brand-200" : ""}`}>{q.answered_at ? "답변 완료" : "답변 대기"}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{q.mine ? "내 질문" : q.author} · {dateTimeKo(q.created_at)}</p>
            <p className="mt-1.5 whitespace-pre-wrap">{q.body}</p>
            {q.answers.map((a) => (
              <div key={a.id} className="mt-2 rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
                <p className="text-xs font-semibold text-brand-700">{a.author} 답변 · {dateTimeKo(a.created_at)}</p>
                <p className="mt-1 whitespace-pre-wrap">{a.body}</p>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
