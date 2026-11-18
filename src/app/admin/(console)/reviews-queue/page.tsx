import Link from "next/link";
import { approveCourseAction, rejectCourseAction } from "@/app/admin/actions";
import { DemoBadge } from "@/components/DemoBadge";
import { Card, Flash, PageTitle } from "@/components/admin/ui";
import { LEVEL_LABEL, dateTimeKo, durationKo, won } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard } from "../guard";

export const metadata = { title: "강의 심사" };

export default async function ReviewQueue({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("review_courses");
  const queue = await db.course.findMany({
    where: { status: "in_review" },
    include: {
      instructor: true,
      category: true,
      sections: { orderBy: { sort: "asc" }, include: { lectures: { orderBy: { sort: "asc" }, select: { id: true, title: true, duration_sec: true, is_preview: true } } } },
    },
    orderBy: { updated_at: "asc" },
  });
  const recent = await db.auditLog.findMany({ where: { action: { in: ["course.approve", "course.reject"] } }, orderBy: { created_at: "desc" }, take: 8 });
  return (
    <>
      <PageTitle title="강의 심사" sub="오래 기다린 강의부터 보여요. 반려할 때는 강사가 고칠 수 있게 사유를 구체적으로 적어 주세요." />
      <Flash sp={sp} />
      {queue.length === 0 && <Card><p className="text-sm text-slate-500">심사를 기다리는 강의가 없어요.</p></Card>}
      <div className="space-y-4">
        {queue.map((c) => {
          const lectures = c.sections.flatMap((s) => s.lectures);
          const total = lectures.reduce((a, l) => a + l.duration_sec, 0);
          return (
            <Card key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-slate-500">{c.code} · {c.category.name} · {LEVEL_LABEL[c.level] ?? c.level}</p>
                  <h2 className="mt-0.5 text-lg font-bold"><Link href={`/admin/courses/${c.code}`} className="hover:underline">{c.title}</Link></h2>
                  <p className="text-sm text-slate-600">{c.subtitle}</p>
                  <p className="mt-1 text-sm">{c.instructor.display_name} <DemoBadge className="ml-1" /> · {won(c.price)} · 강 {lectures.length}개 · {durationKo(total)} · 요청 {dateTimeKo(c.updated_at.toISOString())}</p>
                </div>
                <form action={approveCourseAction}>
                  <input type="hidden" name="code" value={c.code} />
                  <button className="btn-primary">승인하고 공개</button>
                </form>
              </div>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-slate-500">소개와 커리큘럼 보기</summary>
                <p className="mt-2 whitespace-pre-line text-slate-700">{c.intro || "소개가 비어 있어요."}</p>
                <ol className="mt-2 space-y-2">
                  {c.sections.map((s) => (
                    <li key={s.id}>
                      <p className="font-medium">{s.title}</p>
                      <ul className="ml-4 list-disc text-slate-600">
                        {s.lectures.map((l) => <li key={l.id}>{l.title} · {durationKo(l.duration_sec)}{l.is_preview ? " · 맛보기" : ""}</li>)}
                      </ul>
                    </li>
                  ))}
                </ol>
              </details>
              <form action={rejectCourseAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="code" value={c.code} />
                <div className="min-w-64 flex-1">
                  <label htmlFor={`reason-${c.id}`} className="label">반려 사유</label>
                  <input id={`reason-${c.id}`} name="reason" required maxLength={1000} className="field" placeholder="예: 3강 음성이 중간에 끊겨요. 다시 올려 주세요." />
                </div>
                <button className="btn border border-rose-300 bg-white text-rose-700 hover:bg-rose-50">반려</button>
              </form>
            </Card>
          );
        })}
      </div>
      {recent.length > 0 && (
        <Card title="최근 심사 기록" className="mt-6">
          <ul className="text-sm text-slate-600">
            {recent.map((a) => <li key={a.id}>{dateTimeKo(a.created_at.toISOString())} · {a.target.replace("course:", "")} · {a.action === "course.approve" ? "승인" : "반려"}</li>)}
          </ul>
        </Card>
      )}
    </>
  );
}
