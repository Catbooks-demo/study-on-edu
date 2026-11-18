import type { Metadata } from "next";
import Link from "next/link";
import { DemoBadge } from "@/components/DemoBadge";
import { InstructorAvatar } from "@/components/InstructorAvatar";
import { dateTimeKo } from "@/lib/format";
import { upcomingLive } from "@/server/catalog";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "라이브" };

/** 라이브 일정: 다가오는·방송 중인 라이브와 최근 다시보기. */
export default async function LiveListPage() {
  const now = new Date();
  const [upcoming, replays] = await Promise.all([
    upcomingLive(now),
    db.liveSession.findMany({
      where: { status: "ended", replay_lecture_id: { not: null }, course: { status: "published" } },
      orderBy: { starts_at: "desc" },
      take: 6,
      include: { course: { select: { code: true, title: true } }, instructor: { select: { slug: true, display_name: true } } },
    }),
  ]);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">라이브</h1>
      <p className="mt-1 text-sm text-slate-600">강사와 실시간으로 묻고 답해요. 자리를 예약하고, 시작 10분 전부터 들어올 수 있어요.</p>
      {upcoming.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">예정된 라이브가 없어요.</p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {upcoming.map((l) => {
            const onAir = new Date(l.starts_at) <= now;
            return (
              <li key={l.id} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={onAir ? "badge bg-rose-50 font-bold text-rose-700 ring-rose-200" : "badge"}>{onAir ? "방송 중" : dateTimeKo(l.starts_at)}</span>
                  <span className={`badge ${l.course ? "bg-brand-50 text-brand-700 ring-brand-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>
                    {l.course ? "수강생" : "누구나"}
                  </span>
                </div>
                <Link href={`/live/${l.id}`} className="mt-2 block font-bold hover:text-brand-700">{l.title}</Link>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">{l.description}</p>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                  <InstructorAvatar slug={l.instructor.slug} name={l.instructor.display_name} size={18} />
                  {l.instructor.display_name}
                  <DemoBadge className="text-[10px]" />
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {replays.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-bold">다시보기</h2>
          <ul className="mt-3 divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
            {replays.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="font-semibold">{r.title}</span>
                <Link href={`/courses/${r.course!.code}`} className="text-brand-600 hover:underline">{r.course!.title}에서 보기</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
