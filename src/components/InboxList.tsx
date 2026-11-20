"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { dateTimeKo } from "@/lib/format";

export type InboxItem = { id: string; kind: string; title: string; body: string; link: string | null; read: boolean; created_at: string };

/** 메시지함 목록: 하나씩 또는 모두 읽음 표시. */
export function InboxList({ items }: { items: InboxItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unread = items.filter((m) => !m.read).length;

  async function read(ids?: string[]) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/me/inbox/read", ids ? { ids } : {});
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return <p className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-slate-600 ring-1 ring-slate-200">아직 받은 메시지가 없어요. 쿠폰이나 안내가 오면 여기에 모여요.</p>;
  }
  return (
    <>
      <div className="mt-4 flex items-center justify-between text-sm">
        <p className="text-slate-600">안 읽은 메시지 <b className="text-brand-700">{unread}</b>개</p>
        {unread > 0 && <button type="button" className="btn-line" onClick={() => read()} disabled={busy}>모두 읽음으로 표시</button>}
      </div>
      {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
      <ul className="mt-3 divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
        {items.map((m) => (
          <li key={m.id} data-testid="inbox-item" className={`px-5 py-4 text-sm ${m.read ? "" : "bg-brand-50/60"}`}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold">
                {!m.read && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand-500 align-middle" aria-label="안 읽음" />}
                {m.kind === "coupon" && <span className="badge mr-2">쿠폰</span>}
                {m.title}
              </p>
              <span className="shrink-0 text-xs text-slate-400">{dateTimeKo(m.created_at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-slate-700">{m.body}</p>
            <div className="mt-2 flex gap-3 text-xs">
              {m.link && (
                <Link href={m.link} className="font-semibold text-brand-600 hover:underline" onClick={() => !m.read && read([m.id])}>
                  {m.kind === "coupon" ? "쿠폰함 보기" : "자세히 보기"}
                </Link>
              )}
              {!m.read && <button type="button" className="text-slate-500 underline" onClick={() => read([m.id])} disabled={busy}>읽음</button>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
