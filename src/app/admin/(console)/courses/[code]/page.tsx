import Link from "next/link";
import { notFound } from "next/navigation";
import { approveCourseAction, courseEditAction, courseHideAction } from "@/app/admin/actions";
import { DemoBadge } from "@/components/DemoBadge";
import { ActionButton, Card, Dl, Flash, PageTitle, Pill, toneOf } from "@/components/admin/ui";
import { COURSE_STATUS_LABEL, LEVEL_LABEL, accessLabel, dateTimeKo, durationKo, won } from "@/lib/format";
import { kstDate } from "@/rules/time";
import { db } from "@/server/db";
import { can } from "@/server/roles";
import { type SP, guard } from "../../guard";

export const metadata = { title: "강의 상세" };

export default async function CourseDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: SP }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const st = await guard("catalog");
  const c = await db.course.findUnique({
    where: { code },
    include: {
      instructor: true,
      category: true,
      sections: { orderBy: { sort: "asc" }, include: { lectures: { orderBy: { sort: "asc" } } } },
      _count: { select: { enrollments: true, reviews: true, questions: true } },
    },
  });
  if (!c) notFound();
  const lectures = c.sections.flatMap((s) => s.lectures);
  return (
    <>
      <PageTitle title={c.title} sub={`${c.code} · ${c.category.name} · ${LEVEL_LABEL[c.level] ?? c.level}`}>
        <div className="flex items-center gap-3 text-sm">
          {c.status === "published" && <Link href={`/courses/${c.code}`} className="text-brand-700 hover:underline">수강생 화면에서 보기</Link>}
          <Link href="/admin/courses" className="text-slate-500 hover:underline">← 강의 목록</Link>
        </div>
      </PageTitle>
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <Card title="요약">
            <Dl
              rows={[
                ["상태", <Pill key="s" tone={toneOf(c.status)}>{COURSE_STATUS_LABEL[c.status] ?? c.status}</Pill>],
                ["강사", <span key="i">{c.instructor.display_name} <DemoBadge /></span>],
                ["수강 기간", accessLabel(c.access_days)],
                ["강", `${lectures.length}개 · ${durationKo(lectures.reduce((a, l) => a + l.duration_sec, 0))}`],
                ["수강생", `${c._count.enrollments}명`],
                ["후기·질문", `${c._count.reviews} · ${c._count.questions}`],
                ["평점", c.rating_count ? `${c.rating_avg.toFixed(2)} (${c.rating_count})` : "-"],
                ["공개", c.published_at ? dateTimeKo(c.published_at.toISOString()) : "-"],
                ...(c.reject_reason ? [["반려 사유", c.reject_reason] as [string, string]] : []),
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {c.status === "published" && <ActionButton action={courseHideAction} fields={{ code: c.code, hidden: "true" }} label="목록에서 숨기기" tone="danger" confirm="숨기면 목록·검색에서 빠져요. 이미 산 수강생은 계속 볼 수 있어요." />}
              {c.status === "hidden" && <ActionButton action={courseHideAction} fields={{ code: c.code, hidden: "false" }} label="다시 공개" />}
              {c.status === "in_review" && can(st.role, "review_courses") && <ActionButton action={approveCourseAction} fields={{ code: c.code, back: `/admin/courses/${c.code}` }} label="심사 승인" tone="primary" />}
            </div>
          </Card>
          <Card title="판매 정보 고치기">
            <form action={courseEditAction} className="space-y-3 text-sm">
              <input type="hidden" name="code" value={c.code} />
              <div><label htmlFor="title" className="label">제목</label><input id="title" name="title" defaultValue={c.title} required maxLength={200} className="field" /></div>
              <div><label htmlFor="subtitle" className="label">부제</label><input id="subtitle" name="subtitle" defaultValue={c.subtitle} maxLength={300} className="field" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label htmlFor="price" className="label">정가 (원)</label><input id="price" name="price" inputMode="numeric" defaultValue={c.price} required className="field" /></div>
                <div><label htmlFor="sale_price" className="label">할인가 (원)</label><input id="sale_price" name="sale_price" inputMode="numeric" defaultValue={c.sale_price ?? ""} className="field" /></div>
              </div>
              <div><label htmlFor="sale_ends_on" className="label">할인 마감일 (그날 23:59까지)</label><input id="sale_ends_on" name="sale_ends_on" type="date" defaultValue={c.sale_ends_at ? kstDate(c.sale_ends_at) : ""} className="field" /></div>
              <label className="flex items-center gap-2"><input type="checkbox" name="in_subscription" defaultChecked={c.in_subscription} /> 구독 대상 강의</label>
              <button className="btn-primary w-full">저장</button>
            </form>
          </Card>
        </div>
        <Card title="커리큘럼">
          <ol className="space-y-3 text-sm">
            {c.sections.map((s) => (
              <li key={s.id}>
                <p className="font-semibold">{s.title}</p>
                <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-100">
                  {s.lectures.map((l) => (
                    <li key={l.id} className="flex justify-between gap-2 px-3 py-1.5">
                      <span className="truncate">{l.sort}. {l.title}{l.is_preview && <span className="ml-2 text-xs text-brand-600">맛보기</span>}{l.has_resource && <span className="ml-2 text-xs text-slate-500">자료</span>}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">{durationKo(l.duration_sec)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-slate-500">커리큘럼은 강사가 강사 화면에서 고치고 심사를 받아요. 판매가 {won(c.sale_price ?? c.price)}.</p>
        </Card>
      </div>
    </>
  );
}
