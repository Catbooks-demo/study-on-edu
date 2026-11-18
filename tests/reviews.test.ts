import { beforeEach, describe, expect, it } from "vitest";
import { POST as reviewsPost } from "@/app/api/reviews/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { getCourse } from "@/server/catalog";
import { db } from "@/server/db";
import { hideReview, writeReview } from "@/server/reviews";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { loginCookie, makeCourse, makeStaff, makeUser } from "./helpers/fixtures";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

/** lengths 강 중 doneIdx 강을 끝까지 본 수강생. */
async function learner(course: { id: string }, lectures: { id: string; duration_sec: number }[], doneIdx: number[]) {
  const user = await makeUser();
  await db.enrollment.create({ data: { user_id: user.id, course_id: course.id, source: "free", starts_at: new Date(), expires_at: null } });
  for (const i of doneIdx) {
    const l = lectures[i];
    await db.lectureProgress.create({
      data: { user_id: user.id, lecture_id: l.id, course_id: course.id, watched_sec: l.duration_sec, ranges: [[0, l.duration_sec]], completed_at: new Date() },
    });
  }
  return user;
}

const BODY = "설명이 차근차근해서 따라가기 좋았어요.";

describe("후기", () => {
  it("39% → 403", async () => {
    const { course, lectures } = await makeCourse({ lectures: [390, 610] });
    const user = await learner(course, lectures, [0]);
    await expect(writeReview(user.id, course.code, { rating: 5, body: BODY }, new Date())).rejects.toMatchObject({
      status: 403,
      code: "REVIEW_TOO_EARLY",
      message: "진도율 40%부터 후기를 쓸 수 있어요.",
    });
  });

  it("40% → ok", async () => {
    const { course, lectures } = await makeCourse({ lectures: [400, 600] });
    const user = await learner(course, lectures, [0]);
    const r = await writeReview(user.id, course.code, { rating: 4, body: BODY }, new Date());
    expect(r.rating).toBe(4);
    const c = await db.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(c.rating_avg).toBe(4);
    expect(c.rating_count).toBe(1);
  });

  it("second 409", async () => {
    const { course, lectures } = await makeCourse({ lectures: [400, 600] });
    const user = await learner(course, lectures, [0]);
    await writeReview(user.id, course.code, { rating: 4, body: BODY }, new Date());
    await expect(writeReview(user.id, course.code, { rating: 2, body: BODY }, new Date())).rejects.toMatchObject({ status: 409 });
    expect(await db.review.count()).toBe(1);
  });

  it("rating 1..5 and body 10..1000 via route", async () => {
    const { course, lectures } = await makeCourse({ lectures: [400, 600] });
    const user = await learner(course, lectures, [0]);
    const cookies = await loginCookie(user.id);
    expect((await call(reviewsPost, { cookies, body: { course_code: course.code, rating: 6, body: BODY } })).status).toBe(400);
    expect((await call(reviewsPost, { cookies, body: { course_code: course.code, rating: 5, body: "짧아요" } })).status).toBe(400);
    expect((await call(reviewsPost, { cookies, body: { course_code: course.code, rating: 5, body: "가".repeat(1001) } })).status).toBe(400);
    expect((await call(reviewsPost, { cookies, body: { course_code: course.code, rating: 5, body: BODY } })).status).toBe(201);
  });

  it("rating avg recalculated on hide", async () => {
    const { course, lectures } = await makeCourse({ lectures: [400, 600] });
    const a = await learner(course, lectures, [0, 1]);
    const b = await learner(course, lectures, [0]);
    await writeReview(a.id, course.code, { rating: 5, body: BODY }, new Date());
    const low = await writeReview(b.id, course.code, { rating: 1, body: "생각보다 어려웠어요. 기초가 더 필요해요." }, new Date());
    let c = await db.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(c.rating_avg).toBe(3);
    expect(c.rating_count).toBe(2);
    const staff = await makeStaff("cs");
    await hideReview(staff.id, low.id, true);
    c = await db.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(c.rating_avg).toBe(5);
    expect(c.rating_count).toBe(1);
    expect(await db.auditLog.count({ where: { target: `review:${low.id}` } })).toBe(1);
    await hideReview(staff.id, low.id, false);
    c = await db.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(c.rating_count).toBe(2);
  });

  it("course detail sorts reviews: latest, high, low", async () => {
    const { course, lectures } = await makeCourse({ lectures: [400, 600] });
    const ratings = [3, 5, 1];
    for (const [i, rating] of ratings.entries()) {
      const u = await learner(course, lectures, [0]);
      await writeReview(u.id, course.code, { rating, body: `${BODY} ${i}` }, new Date(Date.now() + i * 1000));
    }
    expect((await getCourse(course.code, new Date(), { reviewSort: "latest" }))!.reviews.map((r) => r.rating)).toEqual([1, 5, 3]);
    expect((await getCourse(course.code, new Date(), { reviewSort: "high" }))!.reviews.map((r) => r.rating)).toEqual([5, 3, 1]);
    expect((await getCourse(course.code, new Date(), { reviewSort: "low" }))!.reviews.map((r) => r.rating)).toEqual([1, 3, 5]);
  });
});
