import type { Metadata } from "next";
import { dateTimeKo } from "@/lib/format";
import { listNotices } from "@/server/support";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "공지사항" };

export default async function NoticesPage() {
  const notices = await listNotices();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">공지사항</h1>
      <ul className="mt-6 divide-y divide-slate-200 rounded-2xl bg-white ring-1 ring-slate-200">
        {notices.map((n, i) => (
          <li key={n.id} id={`n-${n.id}`} className="scroll-mt-32">
            <details open={i === 0}>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 hover:bg-slate-50">
                {n.pinned && <span className="badge bg-brand-50 text-brand-700 ring-brand-200">중요</span>}
                <span className="flex-1 font-semibold">{n.title}</span>
                <span className="text-xs text-slate-400">{dateTimeKo(n.created_at.toISOString()).split(" ").slice(0, 2).join(" ")}</span>
              </summary>
              <p className="px-5 pb-5 text-sm leading-7 text-slate-700">{n.body}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
