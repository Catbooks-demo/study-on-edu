import { questionAnswerAction } from "@/app/admin/actions";
import { Card, Flash, PageTitle, Pill, Tabs } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { listQuestions } from "@/server/qa";
import { type SP, guard } from "../guard";

export const metadata = { title: "강의 질문" };

export default async function Questions({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("support");
  const all = sp.all === "1";
  const now = new Date();
  const rows = await listQuestions({ unansweredOnly: !all, take: 100 }, now);
  if (!all) rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  const back = all ? "/admin/questions?all=1" : "/admin/questions";
  return (
    <>
      <PageTitle title="강의 질문" sub="질문 답변 기한은 7일이에요. 강사가 답하지 못한 질문은 운영팀이 대신 답할 수 있어요." />
      <Flash sp={sp} />
      <Tabs current={all ? "all" : "open"} items={[{ key: "open", label: "미답변", href: "/admin/questions" }, { key: "all", label: "전체", href: "/admin/questions?all=1" }]} />
      {rows.length === 0 && <Card><p className="text-sm text-slate-500">답을 기다리는 질문이 없어요.</p></Card>}
      <div className="space-y-3">
        {rows.map((q) => (
          <Card key={q.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs text-slate-500">{q.course.title} · {q.lecture.sort}강 {q.lecture.title} · {q.user.name} · {dateTimeKo(q.created_at.toISOString())}</p>
                <h2 className="font-bold">{q.title}</h2>
              </div>
              {q.overdue ? <Pill tone="red">7일 넘음</Pill> : q.answered_at ? <Pill tone="green">답변함</Pill> : <Pill tone="amber">답변 대기</Pill>}
            </div>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{q.body}</p>
            {q.answers.map((a) => (
              <p key={a.id} className="mt-2 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm">
                <span className="mb-1 block text-xs font-semibold text-slate-500">{a.author_kind === "staff" ? "운영팀" : "강사"} · {dateTimeKo(a.created_at.toISOString())}</span>
                {a.body}
              </p>
            ))}
            <form action={questionAnswerAction} className="mt-3 flex gap-2">
              <input type="hidden" name="id" value={q.id} />
              <input type="hidden" name="back" value={back} />
              <label htmlFor={`qa-${q.id}`} className="sr-only">답변</label>
              <textarea id={`qa-${q.id}`} name="body" rows={2} required maxLength={5000} className="field" placeholder="운영팀 이름으로 답변해요." />
              <button className="btn-line shrink-0 px-3">답변</button>
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}
