import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CurriculumSidebar } from "@/components/player/CurriculumSidebar";
import { LearnPlayer } from "@/components/player/LearnPlayer";
import { currentUser } from "@/server/auth/current";
import { HttpError } from "@/server/http";
import { type PlayerInfo, playerInfo } from "@/server/player";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "강의 보기" };

type Props = { params: Promise<{ courseCode: string; lectureId: string }> };

/** 플레이어: 가짜 영상·진도·이어보기·노트·질문·자료, 커리큘럼 사이드바. */
export default async function LearnPage({ params }: Props) {
  const { courseCode, lectureId } = await params;
  const user = await currentUser();
  let info: PlayerInfo;
  try {
    info = await playerInfo(user?.id ?? null, lectureId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    if (e instanceof HttpError && e.status === 403) {
      if (!user) redirect(`/login?next=${encodeURIComponent(`/learn/${courseCode}/${lectureId}`)}`);
      return (
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <h1 className="text-xl font-bold">{e.message}</h1>
          <p className="mt-2 text-sm text-slate-600">수강 기간이 끝났거나 구독이 일시정지 중이면 볼 수 없어요.</p>
          <Link href={`/courses/${courseCode}`} className="btn-primary mt-6 inline-flex px-4 py-2">강의 보러 가기</Link>
        </div>
      );
    }
    throw e;
  }
  if (info.course.code !== courseCode) redirect(`/learn/${info.course.code}/${lectureId}`);
  const current = info.sections.flatMap((s) => s.lectures).find((l) => l.id === lectureId);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <nav aria-label="위치" className="text-sm text-slate-500">
        <Link href={info.enrolled ? "/my/classroom" : `/courses/${info.course.code}`} className="hover:underline">{info.enrolled ? "내 강의실" : "강의 상세"}</Link>
        <span className="mx-1.5">›</span>
        <Link href={`/courses/${info.course.code}`} className="hover:underline">{info.course.title}</Link>
      </nav>
      <h1 className="mt-2 text-xl font-extrabold tracking-tight">{info.lecture.sort}. {info.lecture.title}</h1>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_320px]">
        <LearnPlayer
          key={info.lecture.id}
          lecture={info.lecture}
          course={info.course}
          enrolled={info.enrolled}
          resumeSec={info.resume_sec}
          downloaded={info.downloaded}
          initial={{ watched_sec: current?.watched_sec ?? 0, done: current?.done ?? false, course_progress: info.course_progress }}
        />
        <aside>
          <CurriculumSidebar courseCode={info.course.code} sections={info.sections} currentId={info.lecture.id} enrolled={info.enrolled} />
        </aside>
      </div>
    </div>
  );
}
