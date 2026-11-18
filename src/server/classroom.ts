import { isCompleted } from "@/rules/progress";
import { db } from "./db";
import { courseProgressFor } from "./player";

export type ClassCard = {
  course_code: string;
  course_id: string;
  title: string;
  category: string;
  instructor: string;
  progress_ratio: number;
  resume: { lecture_id: string; position_sec: number } | null;
  first_lecture_id: string | null;
  expires_at: string | null;
  source: string;
  certificate: string | null;
};

/** 구독 수강권으로 재생할 수 있는 구독 상태. */
const SUB_PLAYABLE = ["active", "past_due"];

/**
 * 내 강의실: 수강 중·완강·만료. 환불한 수강권은 빼고, 진도는 완료한 강 길이 기준.
 * 지금 재생할 수 없는 수강권(기한 지남·expired·구독 일시정지·끝남)은 만료로 둔다.
 * 이어보기 대상은 last_watched_at이 가장 최근인 강이다.
 */
export async function myClassroom(userId: string, now: Date = new Date()): Promise<{ active: ClassCard[]; completed: ClassCard[]; expired: ClassCard[] }> {
  const enrollments = await db.enrollment.findMany({
    where: { user_id: userId, status: { not: "refunded" } },
    include: {
      subscription: { select: { status: true } },
      course: {
        select: {
          id: true,
          code: true,
          title: true,
          category: { select: { code: true } },
          instructor: { select: { display_name: true } },
          lectures: { select: { id: true }, orderBy: { sort: "asc" }, take: 1 },
        },
      },
    },
    orderBy: { updated_at: "desc" },
  });
  const certs = await db.certificate.findMany({ where: { user_id: userId }, select: { course_id: true, number: true } });
  const certBy = new Map(certs.map((c) => [c.course_id, c.number]));
  const out = { active: [] as (ClassCard & { at: number })[], completed: [] as (ClassCard & { at: number })[], expired: [] as (ClassCard & { at: number })[] };

  for (const e of enrollments) {
    const [{ ratio }, latest] = await Promise.all([
      courseProgressFor(db, userId, e.course_id),
      db.lectureProgress.findFirst({ where: { user_id: userId, course_id: e.course_id }, orderBy: { last_watched_at: "desc" } }),
    ]);
    const playable =
      e.status === "active" &&
      (e.expires_at === null || e.expires_at > now) &&
      (e.source !== "subscription" || (!!e.subscription && SUB_PLAYABLE.includes(e.subscription.status)));
    const card = {
      course_code: e.course.code,
      course_id: e.course.id,
      title: e.course.title,
      category: e.course.category.code,
      instructor: e.course.instructor.display_name,
      progress_ratio: ratio,
      resume: latest ? { lecture_id: latest.lecture_id, position_sec: latest.last_position_sec } : null,
      first_lecture_id: e.course.lectures[0]?.id ?? null,
      expires_at: e.expires_at?.toISOString() ?? null,
      source: e.source,
      certificate: certBy.get(e.course_id) ?? null,
      at: latest?.last_watched_at.getTime() ?? e.created_at.getTime(),
    };
    if (!playable) out.expired.push(card);
    else if (isCompleted(ratio)) out.completed.push(card);
    else out.active.push(card);
  }
  const strip = (xs: (ClassCard & { at: number })[]): ClassCard[] =>
    xs.sort((a, b) => b.at - a.at).map(({ at: _at, ...c }) => c); // eslint-disable-line @typescript-eslint/no-unused-vars
  return { active: strip(out.active), completed: strip(out.completed), expired: strip(out.expired) };
}
