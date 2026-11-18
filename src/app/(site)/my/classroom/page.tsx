import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClassCardView } from "@/components/ClassCardView";
import { currentUser } from "@/server/auth/current";
import { myClassroom } from "@/server/classroom";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "내 강의실" };

const GROUPS = [
  ["active", "수강 중", "수강 중인 강의가 없어요."],
  ["completed", "완강", "진도율 80%를 넘긴 강의가 여기에 모여요."],
  ["expired", "만료", "수강 기간이 끝난 강의가 없어요."],
] as const;

/** 내 강의실: 수강 중·완강·만료, 진도율, 이어보기, 수료증. */
export default async function ClassroomPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my/classroom");
  const c = await myClassroom(user.id);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <p className="text-sm"><Link href="/my" className="text-brand-600 hover:underline">마이페이지</Link></p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">내 강의실</h1>
        <nav aria-label="학습 메뉴" className="flex gap-3 text-sm font-semibold text-brand-700">
          <Link href="/my/notes" className="hover:underline">노트 모아보기</Link>
          <Link href="/my/questions" className="hover:underline">내 질문</Link>
          <Link href="/my/devices" className="hover:underline">기기 관리</Link>
        </nav>
      </div>
      {GROUPS.map(([key, label, empty]) => (
        <section key={key} className="mt-8" aria-labelledby={`g-${key}`}>
          <h2 id={`g-${key}`} className="text-lg font-bold">{label} <span className="text-sm font-medium text-slate-500">{c[key].length}</span></h2>
          {c[key].length === 0 ? (
            <p className="mt-3 rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
              {empty} {key === "active" && <Link href="/courses" className="font-semibold text-brand-600 underline">강의 둘러보기</Link>}
            </p>
          ) : (
            <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {c[key].map((x) => <ClassCardView key={x.course_code} c={x} kind={key} />)}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
