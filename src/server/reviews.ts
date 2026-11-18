import { Prisma, type Review } from "@prisma/client";
import { canReview } from "@/rules/progress";
import { LIMITS, enforceLimit } from "./auth/ratelimit";
import { audit } from "./audit";
import { db } from "./db";
import { HttpError } from "./http";
import { courseProgressFor } from "./player";
import type { Tx } from "./tx";

/** 숨기지 않은 후기로 강의 rating_avg·rating_count를 다시 계산한다(시드와 같은 방식). */
export async function recalcRating(tx: Tx, courseId: string): Promise<void> {
  const s = await tx.review.aggregate({ where: { course_id: courseId, hidden: false }, _avg: { rating: true }, _count: { _all: true } });
  await tx.course.update({ where: { id: courseId }, data: { rating_avg: s._avg.rating ?? 0, rating_count: s._count._all } });
}

/**
 * 후기 쓰기: 진도율(완료한 강 길이 기준) 40% 미만이면 403 REVIEW_TOO_EARLY, 강의당 하나(두 번째는 409).
 * 쓰기 제한: 계정 10회/10분.
 */
export async function writeReview(userId: string, courseCode: string, input: { rating: number; body: string }, now: Date = new Date()): Promise<Review> {
  enforceLimit(`review:user:${userId}`, ...LIMITS.write, now.getTime());
  const course = await db.course.findUnique({ where: { code: courseCode }, select: { id: true } });
  if (!course) throw new HttpError(404, "NOT_FOUND", "강의를 찾지 못했어요.");
  const e = await db.enrollment.findUnique({ where: { user_id_course_id: { user_id: userId, course_id: course.id } } });
  if (!e || e.status === "refunded") throw new HttpError(403, "NO_ACCESS", "수강한 강의에만 후기를 쓸 수 있어요.");
  const { ratio } = await courseProgressFor(db, userId, course.id);
  if (!canReview(ratio)) throw new HttpError(403, "REVIEW_TOO_EARLY", "진도율 40%부터 후기를 쓸 수 있어요.");
  try {
    return await db.$transaction(async (tx) => {
      const r = await tx.review.create({ data: { user_id: userId, course_id: course.id, rating: input.rating, body: input.body.trim(), created_at: now } });
      await recalcRating(tx, course.id);
      return r;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "REVIEW_EXISTS", "이 강의에는 이미 후기를 썼어요.");
    }
    throw err;
  }
}

/** 후기 숨기기·보이기 (직원). 평점을 다시 계산하고 작업 기록을 남긴다. */
export async function hideReview(staffId: string, id: string, hidden: boolean): Promise<Review> {
  return db.$transaction(async (tx) => {
    const r = await tx.review.findUnique({ where: { id } });
    if (!r) throw new HttpError(404, "NOT_FOUND", "후기를 찾지 못했어요.");
    const out = await tx.review.update({ where: { id }, data: { hidden } });
    await recalcRating(tx, r.course_id);
    await audit(`staff:${staffId}`, hidden ? "review.hide" : "review.show", `review:${id}`, { course_id: r.course_id }, tx);
    return out;
  });
}

/** 이 수강생이 이 강의에 후기를 쓸 수 있는지 (화면 표시용). */
export async function reviewEligibility(userId: string, courseCode: string): Promise<{ enrolled: boolean; ratio: number; written: boolean }> {
  const course = await db.course.findUnique({ where: { code: courseCode }, select: { id: true } });
  if (!course) return { enrolled: false, ratio: 0, written: false };
  const courseId = course.id;
  const [e, mine] = await Promise.all([
    db.enrollment.findUnique({ where: { user_id_course_id: { user_id: userId, course_id: courseId } } }),
    db.review.findUnique({ where: { user_id_course_id: { user_id: userId, course_id: courseId } } }),
  ]);
  const enrolled = !!e && e.status !== "refunded";
  const ratio = enrolled ? (await courseProgressFor(db, userId, courseId)).ratio : 0;
  return { enrolled, ratio, written: !!mine };
}
