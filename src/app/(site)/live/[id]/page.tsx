import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoBadge } from "@/components/DemoBadge";
import { InstructorAvatar } from "@/components/InstructorAvatar";
import { LiveActions } from "@/components/live/LiveActions";
import { dateTimeKo } from "@/lib/format";
import { currentUser } from "@/server/auth/current";
import { db } from "@/server/db";
import { ENTRY_OPENS_BEFORE_MS } from "@/server/live";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "라이브" };

const STATUS: Record<string, string> = { scheduled: "예정", live: "방송 중", ended: "끝남", cancelled: "취소" };

export default async function LiveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const live = await db.liveSession.findUnique({
    where: { id },
    include: {
      instructor: { select: { slug: true, display_name: true } },
      course: { select: { code: true, title: true, status: true } },
      _count: { select: { seats: true } },
    },
  });
  if (!live) notFound();
  const user = await currentUser();
  const seat = user ? await db.liveSeat.findUnique({ where: { session_id_user_id: { session_id: id, user_id: user.id } } }) : null;
  const now = new Date();
  const closed = ["ended", "cancelled"].includes(live.status) || live.ends_at <= now;
  const open = !closed && now.getTime() >= live.starts_at.getTime() - ENTRY_OPENS_BEFORE_MS;
  const minutes = Math.round((live.ends_at.getTime() - live.starts_at.getTime()) / 60_000);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-sm"><Link href="/live" className="text-brand-600 hover:underline">라이브</Link></p>
      <div className="mt-2 grid gap-8 md:grid-cols-[1fr_18rem]">
        <div>
          <span className="badge">{STATUS[live.status] ?? live.status}</span>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{live.title}</h1>
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <InstructorAvatar slug={live.instructor.slug} name={live.instructor.display_name} size={24} />
            <Link href={`/instructors/${live.instructor.slug}`} className="font-semibold hover:text-brand-700">{live.instructor.display_name}</Link>
            <DemoBadge />
          </p>
          <p className="mt-5 leading-7 text-slate-700">{live.description}</p>
          {live.course && live.course.status === "published" && (
            <p className="mt-5 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
              <Link href={`/courses/${live.course.code}`} className="font-semibold underline">{live.course.title}</Link> 수강생만 예약할 수 있어요. 구독 대상 강의면 구독으로도 들어올 수 있어요.
            </p>
          )}
        </div>
        <aside className="h-fit rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">시작</dt><dd>{dateTimeKo(live.starts_at.toISOString())}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">길이</dt><dd>{minutes}분</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">예약</dt><dd className="tabular-nums">{live._count.seats} / {live.capacity}명</dd></div>
          </dl>
          <div className="mt-5">
            <LiveActions
              id={live.id}
              loggedIn={!!user}
              reserved={!!seat}
              full={live._count.seats >= live.capacity}
              open={open}
              closed={closed}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
