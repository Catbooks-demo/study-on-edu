import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { clock } from "@/lib/format";
import { currentUser } from "@/server/auth/current";
import { listNotes } from "@/server/notes";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "노트 모아보기" };

/** 노트 모아보기: 강의별·강 순서·시점 순. */
export default async function NotesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my/notes");
  const notes = await listNotes(user.id);
  const groups = new Map<string, { code: string; title: string; items: typeof notes }>();
  for (const n of notes) {
    const g = groups.get(n.course_id) ?? { code: n.course.code, title: n.course.title, items: [] };
    g.items.push(n);
    groups.set(n.course_id, g);
  }
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-sm"><Link href="/my/classroom" className="text-brand-600 hover:underline">내 강의실</Link></p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight">노트 모아보기</h1>
      {groups.size === 0 && <p className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-slate-600 ring-1 ring-slate-200">아직 남긴 노트가 없어요. 플레이어 아래 노트 탭에서 시점과 함께 남길 수 있어요.</p>}
      {[...groups.values()].map((g) => (
        <section key={g.code} className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <h2 className="font-bold">{g.title}</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {g.items.map((n) => (
              <li key={n.id} className="py-3 text-sm">
                <p className="text-xs text-slate-500">
                  <Link href={`/learn/${g.code}/${n.lecture_id}`} className="font-semibold text-brand-700 hover:underline">{n.lecture.sort}. {n.lecture.title}</Link>
                  <span className="ml-2 font-mono">{clock(n.at_sec)}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
