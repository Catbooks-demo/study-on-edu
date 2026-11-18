import { beforeEach, describe, expect, it } from "vitest";
import { GET as lectureRoute } from "@/app/api/player/lectures/[id]/route";
import { POST as downloadRoute } from "@/app/api/player/lectures/[id]/download/route";
import { POST as heartbeatRoute } from "@/app/api/player/heartbeat/route";
import { POST as startRoute } from "@/app/api/player/start/route";
import { GET as notesGet, POST as notesPost } from "@/app/api/notes/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { db } from "@/server/db";
import { addNote, listNotes } from "@/server/notes";
import { activePlaybacks, heartbeat, lectureAccess, markDownloaded, startPlayback } from "@/server/player";
import { previewRefund } from "@/server/refunds";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { loginCookie, makeCourse, makePaidOrder, makeSubscription, makeUser } from "./helpers/fixtures";

const DAY = 86_400_000;
const DEV_A = "device-aaaaaaaa";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

const at = (base: Date, sec: number) => new Date(base.getTime() + sec * 1000);

/** 강의 하나를 산 수강생 (수강권 source=order). */
async function enrolled(lectures = [600, 600], opts: { expiresAt?: Date | null; paidAt?: Date } = {}) {
  const now = new Date();
  const user = await makeUser();
  const { course, lectures: ls } = await makeCourse({ lectures, hasResource: true });
  const { order, item } = await makePaidOrder(user.id, course.id, 99_000, opts.paidAt ?? now);
  await db.enrollment.create({
    data: {
      user_id: user.id,
      course_id: course.id,
      source: "order",
      order_item_id: item.id,
      starts_at: opts.paidAt ?? now,
      expires_at: opts.expiresAt === undefined ? new Date(now.getTime() + 365 * DAY) : opts.expiresAt,
    },
  });
  return { now, user, course, lectures: ls, order, item };
}

const beat = (lecture_id: string, from_sec: number, to_sec: number, rate = 1, device_id = DEV_A) => ({
  lecture_id,
  from_sec,
  to_sec,
  position_sec: to_sec,
  rate,
  device_id,
});

describe("재생 접근", () => {
  it("no enrollment 403", async () => {
    const user = await makeUser();
    const { lectures } = await makeCourse();
    await expect(lectureAccess(user.id, lectures[1].id, new Date())).rejects.toMatchObject({ status: 403, code: "NO_ACCESS" });
    const res = await call(lectureRoute, { cookies: await loginCookie(user.id), params: { id: lectures[1].id } });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("수강권이 있어야 볼 수 있어요.");
  });

  it("preview allowed without login", async () => {
    const { lectures } = await makeCourse();
    await db.lecture.update({ where: { id: lectures[0].id }, data: { is_preview: true } });
    const a = await lectureAccess(null, lectures[0].id, new Date());
    expect(a.preview).toBe(true);
    expect(a.enrollment).toBeNull();
    const res = await call(lectureRoute, { params: { id: lectures[0].id } });
    expect(res.status).toBe(200);
    expect(res.body.lecture.id).toBe(lectures[0].id);
    // 미리보기만 보는 사람의 하트비트는 진도를 남기지 않고 200
    const hb = await call(heartbeatRoute, { body: beat(lectures[0].id, 0, 30) });
    expect(hb.status).toBe(200);
    expect(await db.lectureProgress.count()).toBe(0);
    expect(await db.watchEvent.count()).toBe(0);
  });

  it("expired enrollment 403", async () => {
    const { user, lectures } = await enrolled([600], { expiresAt: new Date(Date.now() - DAY) });
    await expect(lectureAccess(user.id, lectures[0].id, new Date())).rejects.toMatchObject({ status: 403, code: "NO_ACCESS" });
  });

  it("paused subscription 403", async () => {
    const now = new Date();
    const user = await makeUser();
    const { course, lectures } = await makeCourse({ inSubscription: true });
    const sub = await makeSubscription(user.id, now);
    await db.enrollment.create({
      data: { user_id: user.id, course_id: course.id, source: "subscription", subscription_id: sub.id, starts_at: now, expires_at: null },
    });
    expect((await lectureAccess(user.id, lectures[0].id, now)).enrollment?.source).toBe("subscription");
    await db.subscription.update({ where: { id: sub.id }, data: { status: "paused", paused_until: new Date(now.getTime() + 7 * DAY) } });
    await expect(lectureAccess(user.id, lectures[0].id, now)).rejects.toMatchObject({ status: 403, code: "NO_ACCESS" });
  });

  it("active subscription creates subscription enrollment on first access", async () => {
    const now = new Date();
    const user = await makeUser();
    const { course, lectures } = await makeCourse({ inSubscription: true });
    const sub = await makeSubscription(user.id, now);
    const a = await lectureAccess(user.id, lectures[1].id, now);
    expect(a.enrollment).toMatchObject({ source: "subscription", subscription_id: sub.id, expires_at: null, status: "active" });
    expect(await db.enrollment.count({ where: { user_id: user.id, course_id: course.id } })).toBe(1);
    // 두 번째 접근은 새로 만들지 않는다
    await lectureAccess(user.id, lectures[0].id, now);
    expect(await db.enrollment.count({ where: { user_id: user.id, course_id: course.id } })).toBe(1);
  });

  it("subscription does not open courses outside the subscription", async () => {
    const now = new Date();
    const user = await makeUser();
    const { lectures } = await makeCourse({ inSubscription: false });
    await makeSubscription(user.id, now);
    await expect(lectureAccess(user.id, lectures[0].id, now)).rejects.toMatchObject({ status: 403, code: "NO_ACCESS" });
  });
});

describe("하트비트", () => {
  it("heartbeat accumulates", async () => {
    const { now, user, lectures } = await enrolled();
    const l = lectures[0];
    await startPlayback(user.id, { lecture_id: l.id, device_id: DEV_A }, now);
    await heartbeat(user.id, beat(l.id, 0, 30), at(now, 30));
    await heartbeat(user.id, beat(l.id, 30, 60), at(now, 60));
    const r = await heartbeat(user.id, beat(l.id, 60, 90), at(now, 90));
    expect(r.watched_sec).toBe(90);
    expect(r.done).toBe(false);
    const p = await db.lectureProgress.findUniqueOrThrow({ where: { user_id_lecture_id: { user_id: user.id, lecture_id: l.id } } });
    expect(p.watched_sec).toBe(90);
    expect(p.last_position_sec).toBe(90);
    expect(p.ranges).toEqual([[0, 90]]);
    const events = await db.watchEvent.findMany({ where: { user_id: user.id }, orderBy: { created_at: "asc" } });
    expect(events.map((e) => e.added_sec)).toEqual([30, 30, 30]);
    expect(events.every((e) => e.source === "order")).toBe(true);
  });

  it("duplicate heartbeat counts once", async () => {
    const { now, user, lectures } = await enrolled();
    const l = lectures[0];
    await startPlayback(user.id, { lecture_id: l.id, device_id: DEV_A }, now);
    const first = await heartbeat(user.id, beat(l.id, 0, 30), at(now, 30));
    const again = await heartbeat(user.id, beat(l.id, 0, 30), at(now, 31));
    expect(first.watched_sec).toBe(30);
    expect(again.watched_sec).toBe(30);
    const events = await db.watchEvent.findMany({ where: { user_id: user.id }, orderBy: { created_at: "asc" } });
    expect(events).toHaveLength(2);
    expect(events[1].added_sec).toBe(0);
    expect(events.reduce((a, e) => a + e.added_sec, 0)).toBe(30);
  });

  it("out-of-order heartbeat does not double count", async () => {
    const { now, user, lectures } = await enrolled();
    const l = lectures[0];
    await startPlayback(user.id, { lecture_id: l.id, device_id: DEV_A }, now);
    await heartbeat(user.id, beat(l.id, 30, 60), at(now, 60));
    await heartbeat(user.id, beat(l.id, 0, 30), at(now, 90));
    const r = await heartbeat(user.id, beat(l.id, 30, 60), at(now, 120));
    expect(r.watched_sec).toBe(60);
    const sum = await db.watchEvent.aggregate({ where: { user_id: user.id }, _sum: { added_sec: true } });
    expect(sum._sum.added_sec).toBe(60);
  });

  it("heartbeat rejects skip-ahead", async () => {
    const { now, user, lectures } = await enrolled([1500, 600]);
    const l = lectures[0];
    await startPlayback(user.id, { lecture_id: l.id, device_id: DEV_A }, now);
    const r = await heartbeat(user.id, beat(l.id, 0, 1500), at(now, 30));
    expect(r.watched_sec).toBe(41);
    expect(r.done).toBe(false);
    expect(r.course_progress).toBe(0);
    const p = await db.lectureProgress.findUniqueOrThrow({ where: { user_id_lecture_id: { user_id: user.id, lecture_id: l.id } } });
    expect(p.completed_at).toBeNull();
  });

  it("long idle does not bank credit for a skip", async () => {
    const { now, user, lectures } = await enrolled([1500]);
    const l = lectures[0];
    await startPlayback(user.id, { lecture_id: l.id, device_id: DEV_A }, now);
    const r = await heartbeat(user.id, beat(l.id, 0, 1500, 2), at(now, 3600));
    expect(r.watched_sec).toBeLessThan(1500 * 0.9);
    expect(r.done).toBe(false);
  });

  it("heartbeat flood is rate limited", async () => {
    const { now, user, lectures } = await enrolled([1500]);
    const l = lectures[0];
    await startPlayback(user.id, { lecture_id: l.id, device_id: DEV_A }, now);
    let limited = false;
    for (let i = 0; i < 60; i++) {
      try {
        await heartbeat(user.id, beat(l.id, i * 5, i * 5 + 5), at(now, i * 0.5 + 0.5));
      } catch (e) {
        expect(e).toMatchObject({ status: 429, code: "RATE_LIMITED" });
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
    const p = await db.lectureProgress.findUniqueOrThrow({ where: { user_id_lecture_id: { user_id: user.id, lecture_id: l.id } } });
    expect(p.watched_sec).toBeLessThan(150);
  });

  it("bad rate 400", async () => {
    const { user, lectures } = await enrolled();
    const cookies = await loginCookie(user.id);
    await call(startRoute, { cookies, body: { lecture_id: lectures[0].id, device_id: DEV_A } });
    const res = await call(heartbeatRoute, { cookies, body: beat(lectures[0].id, 0, 30, 3) });
    expect(res.status).toBe(400);
    expect(await db.lectureProgress.count({ where: { watched_sec: { gt: 0 } } })).toBe(0);
  });

  it("done at 90% → course_progress updates", async () => {
    const { now, user, lectures } = await enrolled([60, 60]);
    const l = lectures[0];
    await startPlayback(user.id, { lecture_id: l.id, device_id: DEV_A }, now);
    const a = await heartbeat(user.id, beat(l.id, 0, 30), at(now, 30));
    expect(a.done).toBe(false);
    expect(a.course_progress).toBe(0);
    const b = await heartbeat(user.id, beat(l.id, 30, 54), at(now, 60));
    expect(b.watched_sec).toBe(54);
    expect(b.done).toBe(true);
    expect(b.course_progress).toBe(0.5);
    const p = await db.lectureProgress.findUniqueOrThrow({ where: { user_id_lecture_id: { user_id: user.id, lecture_id: l.id } } });
    expect(p.completed_at).toEqual(at(now, 60));
  });

  it("start resumes at last position", async () => {
    const { now, user, lectures } = await enrolled([600]);
    const l = lectures[0];
    const s0 = await startPlayback(user.id, { lecture_id: l.id, device_id: DEV_A }, now);
    expect(s0.resume_sec).toBe(0);
    await heartbeat(user.id, { ...beat(l.id, 0, 30), position_sec: 30 }, at(now, 30));
    const s1 = await startPlayback(user.id, { lecture_id: l.id, device_id: DEV_A }, at(now, 40));
    expect(s1.resume_sec).toBe(30);
  });

  it("start and heartbeat routes need login for enrolled lectures", async () => {
    const { lectures } = await enrolled();
    const res = await call(startRoute, { body: { lecture_id: lectures[1].id, device_id: DEV_A } });
    expect(res.status).toBe(403);
  });

  it("download marks progress for refund", async () => {
    const now = new Date();
    const { user, lectures, item } = await enrolled([600, 600, 600, 600, 600, 600, 600, 600, 600, 600], { paidAt: new Date(now.getTime() - 2 * DAY) });
    const before = await previewRefund(user.id, item.id, now);
    expect(before.kind).toBe("full");
    expect(before.progress_ratio).toBe(0);
    await markDownloaded(user.id, lectures[0].id, now);
    const after = await previewRefund(user.id, item.id, now);
    expect(after.progress_ratio).toBeCloseTo(0.1, 10);
    expect(after.kind).toBe("prorated");
    // 두 번째 받기는 처음 시각을 바꾸지 않는다
    await markDownloaded(user.id, lectures[0].id, new Date(now.getTime() + 60_000));
    const p = await db.lectureProgress.findUniqueOrThrow({ where: { user_id_lecture_id: { user_id: user.id, lecture_id: lectures[0].id } } });
    expect(p.downloaded_at).toEqual(now);
  });

  it("download route returns a pdf and needs enrollment", async () => {
    const { user, lectures } = await enrolled([600]);
    const other = await makeUser();
    const denied = await call(downloadRoute, { method: "POST", cookies: await loginCookie(other.id), params: { id: lectures[0].id } });
    expect(denied.status).toBe(403);
    const req = new Request("http://localhost/test", { method: "POST", headers: { cookie: Object.entries(await loginCookie(user.id)).map(([k, v]) => `${k}=${v}`).join("; ") } });
    const res = await downloadRoute(req, { params: Promise.resolve({ id: lectures[0].id }) } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const text = Buffer.from(await res.arrayBuffer()).toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
  });

  it("active playbacks counts recent leases", async () => {
    const now = new Date();
    const a = await enrolled();
    const b = await enrolled();
    await startPlayback(a.user.id, { lecture_id: a.lectures[0].id, device_id: DEV_A }, now);
    await startPlayback(b.user.id, { lecture_id: b.lectures[0].id, device_id: DEV_A }, new Date(now.getTime() - 120_000));
    expect(await activePlaybacks(now)).toBe(1);
  });
});

describe("노트", () => {
  it("add and list notes", async () => {
    const { user, course, lectures } = await enrolled();
    const n = await addNote(user.id, { lecture_id: lectures[1].id, at_sec: 75, body: "  여기 다시 보기  " });
    expect(n.course_id).toBe(course.id);
    expect(n.body).toBe("여기 다시 보기");
    expect(await listNotes(user.id, course.id)).toHaveLength(1);
    const res = await call(notesGet, { cookies: await loginCookie(user.id), url: `http://localhost/api/notes?course_id=${course.id}` });
    expect(res.status).toBe(200);
    expect(res.body.notes).toHaveLength(1);
  });

  it("note needs enrollment and body ≤ 2000", async () => {
    const { user, lectures } = await enrolled();
    const other = await makeUser();
    await expect(addNote(other.id, { lecture_id: lectures[0].id, at_sec: 1, body: "메모" })).rejects.toMatchObject({ status: 403 });
    const res = await call(notesPost, { cookies: await loginCookie(user.id), body: { lecture_id: lectures[0].id, at_sec: 1, body: "가".repeat(2001) } });
    expect(res.status).toBe(400);
  });
});
