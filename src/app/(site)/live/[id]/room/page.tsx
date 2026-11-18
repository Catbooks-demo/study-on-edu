import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DemoBadge } from "@/components/DemoBadge";
import { LiveRoom } from "@/components/live/LiveRoom";
import { currentUser } from "@/server/auth/current";
import { db } from "@/server/db";
import { hasEntered } from "@/server/live";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "라이브 방송" };

/** 라이브 방: 입장한 사람만. 입장 전이면 상세 화면으로 돌려보낸다. */
export default async function LiveRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/live/${id}`)}`);
  const live = await db.liveSession.findUnique({
    where: { id },
    include: { instructor: { select: { display_name: true } }, course: { include: { category: true } } },
  });
  if (!live) notFound();
  if (!(await hasEntered(user.id, id))) redirect(`/live/${id}`);
  const closed = live.status === "ended" || live.status === "cancelled";
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <p className="text-sm"><Link href={`/live/${id}`} className="text-brand-600 hover:underline">라이브 정보</Link></p>
      <h1 className="mt-1 text-xl font-extrabold tracking-tight">{live.title}</h1>
      <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">{live.instructor.display_name} <DemoBadge /></p>
      <div className="mt-4">
        {closed ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-600 ring-1 ring-slate-200">라이브가 끝났어요. 다시보기가 올라오면 강의에서 볼 수 있어요.</p>
        ) : (
          <LiveRoom
            sessionId={live.id}
            title={live.title}
            startsAt={live.starts_at.toISOString()}
            course={live.course ? { code: live.course.code, category: live.course.category.code, title: live.course.title } : null}
          />
        )}
      </div>
    </div>
  );
}
