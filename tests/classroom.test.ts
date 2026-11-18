import { beforeEach, describe, expect, it } from "vitest";
import { myClassroom } from "@/server/classroom";
import { db } from "@/server/db";
import { resetDb } from "./helpers/db";
import { makeCourse, makeUser } from "./helpers/fixtures";

const DAY = 86_400_000;

beforeEach(resetDb);

async function enroll(userId: string, courseId: string, opts: { expiresAt?: Date | null; status?: string } = {}) {
  return db.enrollment.create({
    data: {
      user_id: userId,
      course_id: courseId,
      source: "free",
      starts_at: new Date(Date.now() - 30 * DAY),
      expires_at: opts.expiresAt === undefined ? null : opts.expiresAt,
      status: opts.status ?? "active",
    },
  });
}

async function watch(userId: string, l: { id: string; course_id: string; duration_sec: number }, sec: number, at: Date, position = sec) {
  await db.lectureProgress.create({
    data: {
      user_id: userId,
      lecture_id: l.id,
      course_id: l.course_id,
      watched_sec: sec,
      ranges: [[0, sec]],
      last_position_sec: position,
      last_watched_at: at,
      completed_at: sec >= l.duration_sec * 0.9 ? at : null,
    },
  });
}

describe("내 강의실", () => {
  it("buckets", async () => {
    const now = new Date();
    const user = await makeUser();
    const done = await makeCourse({ lectures: [500, 100] });
    const going = await makeCourse({ lectures: [600, 600] });
    const old = await makeCourse({ lectures: [600] });
    const refunded = await makeCourse({ lectures: [600] });
    await enroll(user.id, done.course.id);
    await enroll(user.id, going.course.id);
    await enroll(user.id, old.course.id, { expiresAt: new Date(now.getTime() - DAY) });
    await enroll(user.id, refunded.course.id, { status: "refunded" });
    await watch(user.id, done.lectures[0], 500, now);
    await watch(user.id, going.lectures[0], 100, now);

    const c = await myClassroom(user.id, now);
    expect(c.completed.map((x) => x.course_code)).toEqual([done.course.code]);
    expect(c.completed[0].progress_ratio).toBeCloseTo(500 / 600, 10);
    expect(c.active.map((x) => x.course_code)).toEqual([going.course.code]);
    expect(c.active[0].progress_ratio).toBe(0);
    expect(c.expired.map((x) => x.course_code)).toEqual([old.course.code]);
    expect(c.expired[0].expires_at).not.toBeNull();
  });

  it("paused subscription enrollment counts as expired", async () => {
    const now = new Date();
    const user = await makeUser();
    const { course } = await makeCourse({ inSubscription: true });
    const plan = await db.plan.create({ data: { code: "monthly", name: "월 구독", interval: "month", price: 29_000, refund_base_hours: 20 } });
    const sub = await db.subscription.create({
      data: { user_id: user.id, plan_id: plan.id, status: "paused", current_period_start: now, current_period_end: new Date(now.getTime() + 30 * DAY) },
    });
    await db.enrollment.create({
      data: { user_id: user.id, course_id: course.id, source: "subscription", subscription_id: sub.id, starts_at: now, expires_at: null },
    });
    const c = await myClassroom(user.id, now);
    expect(c.active).toHaveLength(0);
    expect(c.expired.map((x) => x.course_code)).toEqual([course.code]);
  });

  it("resume is latest lecture", async () => {
    const now = new Date();
    const user = await makeUser();
    const { course, lectures } = await makeCourse({ lectures: [600, 600, 600] });
    await enroll(user.id, course.id);
    await watch(user.id, lectures[2], 50, new Date(now.getTime() - 2 * DAY), 50);
    await watch(user.id, lectures[0], 120, new Date(now.getTime() - DAY), 130);
    await watch(user.id, lectures[1], 30, new Date(now.getTime() - 3 * DAY), 30);
    const c = await myClassroom(user.id, now);
    expect(c.active[0].resume).toEqual({ lecture_id: lectures[0].id, position_sec: 130 });
  });

  it("no progress → resume null", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    await enroll(user.id, course.id);
    const c = await myClassroom(user.id, new Date());
    expect(c.active[0].resume).toBeNull();
    expect(c.active[0].first_lecture_id).toBeTruthy();
  });
});
