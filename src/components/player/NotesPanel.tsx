"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { clock } from "@/lib/format";

type NoteRow = { id: string; lecture_id: string; at_sec: number; body: string };

/** 이 강의 노트: 지금 시점으로 쓰고, 누르면 그 시점으로 간다. */
export function NotesPanel({ lectureId, courseId, position, onSeek }: { lectureId: string; courseId: string; position: number; onSeek: (sec: number) => void }) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = useCallback(async (): Promise<NoteRow[]> => {
    try {
      const r = await api<{ notes: NoteRow[] }>(`/api/notes?course_id=${encodeURIComponent(courseId)}`);
      return r.notes.filter((n) => n.lecture_id === lectureId);
    } catch {
      return []; // 목록을 못 읽어도 플레이어는 계속
    }
  }, [courseId, lectureId]);
  const load = useCallback(async () => setNotes(await fetchNotes()), [fetchNotes]);

  useEffect(() => {
    let alive = true;
    fetchNotes().then((n) => {
      if (alive) setNotes(n);
    });
    return () => {
      alive = false;
    };
  }, [fetchNotes]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/notes", { lecture_id: lectureId, at_sec: Math.floor(position), body });
      setBody("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api(`/api/notes/${id}`, undefined, "DELETE").catch(() => undefined);
    await load();
  }

  return (
    <div>
      <form onSubmit={add} className="space-y-2">
        <label htmlFor="note-body" className="label">{clock(position)} 시점에 노트 남기기</label>
        <textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={3} required className="field" placeholder="기억하고 싶은 내용을 적어 두세요" />
        <button disabled={busy || !body.trim()} className="btn-primary px-3 py-1.5 text-sm">{busy ? "저장하는 중…" : "노트 저장"}</button>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </form>
      <ul className="mt-4 space-y-2">
        {notes.length === 0 && <li className="text-sm text-slate-500">이 강에 남긴 노트가 없어요.</li>}
        {notes.map((n) => (
          <li key={n.id} className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => onSeek(n.at_sec)} className="font-mono text-xs font-semibold text-brand-700 hover:underline">{clock(n.at_sec)}</button>
              <button type="button" onClick={() => remove(n.id)} className="text-xs text-slate-400 hover:text-red-600">지우기</button>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
