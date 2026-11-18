import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { dateTimeKo } from "@/lib/format";
import { currentUser } from "@/server/auth/current";
import { listQuestions, questionView } from "@/server/qa";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "내 질문" };

export default async function MyQuestionsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my/questions");
  const items = (await listQuestions({ userId: user.id })).map((q) => questionView(q, user.id));
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm"><Link href="/my/classroom" className="text-brand-600 hover:underline">내 강의실</Link></p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight">내 질문</h1>
      <p className="mt-2 text-sm text-slate-600">강사가 7일 안에 답해 드려요. 질문은 플레이어 아래 질문 탭에서 올릴 수 있어요.</p>
      {items.length === 0 && <p className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-slate-600 ring-1 ring-slate-200">올린 질문이 없어요.</p>}
      <ul className="mt-6 space-y-3">
        {items.map((q) => (
          <li key={q.id} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">
              <Link href={`/learn/${q.course_code}/${q.lecture_id}`} className="font-semibold text-brand-700 hover:underline">{q.course_title} · {q.lecture_sort}. {q.lecture_title}</Link>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{q.title}</span>
              <span className={`badge ${q.answered_at ? "bg-brand-50 text-brand-700 ring-brand-200" : ""}`}>{q.answered_at ? "답변 완료" : "답변 대기"}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{dateTimeKo(q.created_at)}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{q.body}</p>
            {q.answers.map((a) => (
              <div key={a.id} className="mt-3 rounded-xl bg-brand-50 p-3 text-sm">
                <p className="text-xs font-semibold text-brand-700">{a.author} 답변 · {dateTimeKo(a.created_at)}</p>
                <p className="mt-1 whitespace-pre-wrap">{a.body}</p>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
