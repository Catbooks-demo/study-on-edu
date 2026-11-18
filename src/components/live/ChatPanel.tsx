"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Chat = { id: number; body: string; name: string; at: string };

const hm = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });

/**
 * 라이브 채팅: SSE(/chat/stream)로 받고, 끊기면 EventSource가 다시 붙는다(Last-Event-ID로 이어 받기).
 * 시청자 수는 viewers 이벤트로 받아 부모에게 알린다.
 */
export function ChatPanel({ sessionId, onViewers }: { sessionId: string; onViewers?: (n: number) => void }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const viewersRef = useRef(onViewers);
  useEffect(() => {
    viewersRef.current = onViewers;
  }, [onViewers]);

  useEffect(() => {
    const es = new EventSource(`/api/live/${sessionId}/chat/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("chat", (ev) => {
      const items = JSON.parse((ev as MessageEvent).data) as Chat[];
      setChats((cur) => {
        const seen = new Set(cur.map((c) => c.id));
        return [...cur, ...items.filter((c) => !seen.has(c.id))].slice(-300);
      });
    });
    es.addEventListener("viewers", (ev) => viewersRef.current?.(JSON.parse((ev as MessageEvent).data).viewers));
    return () => es.close();
  }, [sessionId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chats]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ chat: Chat }>(`/api/live/${sessionId}/chat`, { body: text });
      setChats((cur) => (cur.some((c) => c.id === r.chat.id) ? cur : [...cur, r.chat]));
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex h-[28rem] flex-col rounded-2xl bg-white ring-1 ring-slate-200" aria-label="라이브 채팅">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-sm">
        <span className="font-bold">채팅</span>
        <span className={`text-xs ${connected ? "text-emerald-600" : "text-slate-400"}`}>{connected ? "연결됨" : "연결 중…"}</span>
      </header>
      <ol ref={listRef} className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3 text-sm" data-testid="live-chat-list">
        {chats.length === 0 && <li className="text-slate-400">첫 인사를 남겨 보세요.</li>}
        {chats.map((c) => (
          <li key={c.id}>
            <span className="mr-1.5 font-semibold text-brand-700">{c.name}</span>
            <span className="break-words text-slate-800">{c.body}</span>
            <span className="ml-1.5 text-[10px] text-slate-400">{hm(c.at)}</span>
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="flex gap-2 border-t border-slate-100 p-3">
        <label htmlFor="live-chat-input" className="sr-only">채팅 입력</label>
        <input
          id="live-chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder="질문이나 인사를 남겨요 (200자)"
          className="field min-w-0 flex-1"
        />
        <button type="submit" disabled={busy || !text.trim()} className="btn-primary px-4">보내기</button>
      </form>
      {error && <p className="px-3 pb-2 text-xs text-rose-600" role="alert">{error}</p>}
    </section>
  );
}
