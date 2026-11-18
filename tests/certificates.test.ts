import { beforeEach, describe, expect, it } from "vitest";
import { POST as issueRoute } from "@/app/api/certificates/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { getCertificate, issueCertificate } from "@/server/certificates";
import { db } from "@/server/db";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { loginCookie, makeCourse, makeUser } from "./helpers/fixtures";

const NOW = new Date("2026-11-18T03:00:00Z");

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

/** 강 길이 lengths 중 doneIdx 강을 끝까지 본 수강생. */
async function watched(lengths: number[], doneIdx: number[]) {
  const user = await makeUser();
  const { course, lectures } = await makeCourse({ lectures: lengths });
  await db.enrollment.create({ data: { user_id: user.id, course_id: course.id, source: "free", starts_at: NOW, expires_at: null } });
  for (const i of doneIdx) {
    const l = lectures[i];
    await db.lectureProgress.create({
      data: { user_id: user.id, lecture_id: l.id, course_id: course.id, watched_sec: l.duration_sec, ranges: [[0, l.duration_sec]], completed_at: NOW },
    });
  }
  return { user, course, lectures };
}

describe("수료증", () => {
  it("79% → 409", async () => {
    const { user, course } = await watched([790, 210], [0]);
    await expect(issueCertificate(user.id, course.id, NOW)).rejects.toMatchObject({
      status: 409,
      code: "NOT_COMPLETED",
      message: "진도율 80%를 넘으면 수료증을 받을 수 있어요.",
    });
    expect(await db.certificate.count()).toBe(0);
  });

  it("80% → issued SOC-2026-000001", async () => {
    const { user, course } = await watched([800, 200], [0]);
    const c = await issueCertificate(user.id, course.id, NOW);
    expect(c.number).toBe("SOC-2026-000001");
    expect(c.progress_ratio).toBeCloseTo(0.8, 10);
    expect(c.issued_at).toEqual(NOW);
  });

  it("issue twice same number", async () => {
    const { user, course } = await watched([800, 200], [0]);
    const a = await issueCertificate(user.id, course.id, NOW);
    const b = await issueCertificate(user.id, course.id, new Date(NOW.getTime() + 86_400_000));
    expect(b.number).toBe(a.number);
    expect(b.id).toBe(a.id);
    expect(await db.certificate.count()).toBe(1);
  });

  it("concurrent issue makes one certificate", async () => {
    const { user, course } = await watched([800, 200], [0, 1]);
    const rs = await Promise.all([issueCertificate(user.id, course.id, NOW), issueCertificate(user.id, course.id, NOW)]);
    expect(rs[0].number).toBe(rs[1].number);
    expect(await db.certificate.count()).toBe(1);
  });

  it("needs an enrollment that was not refunded", async () => {
    const { user, course } = await watched([800, 200], [0, 1]);
    await db.enrollment.updateMany({ where: { user_id: user.id }, data: { status: "refunded" } });
    await expect(issueCertificate(user.id, course.id, NOW)).rejects.toMatchObject({ status: 403 });
  });

  it("route issues by course code and only the owner can view", async () => {
    const { user, course } = await watched([800, 200], [0, 1]);
    const res = await call(issueRoute, { cookies: await loginCookie(user.id), body: { course_code: course.code } });
    expect(res.status).toBe(201);
    expect(res.body.certificate.number).toMatch(/^SOC-\d{4}-\d{6}$/);
    const mine = await getCertificate(res.body.certificate.number, user.id);
    expect(mine?.course.code).toBe(course.code);
    const other = await makeUser();
    expect(await getCertificate(res.body.certificate.number, other.id)).toBeNull();
  });
});
