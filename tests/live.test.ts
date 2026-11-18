import { beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { db } from "@/server/db";
import { runJobsOnce } from "@/server/jobs";
import {
  ENTRY_OPENS_BEFORE_MS,
  advanceLiveStatus,
  attachReplay,
  chatSince,
  enterLive,
  postChat,
  reserveSeat,
} from "@/server/live";
import { resetDb } from "./helpers/db";
import { makeCourse, makeInstructor, makeUser } from "./helpers/fixtures";

const MIN = 60_000;
const START = new Date("2026-11-20T11:00:00Z"); // 20:00 KST
const END = new Date(START.getTime() + 60 * MIN);
const at = (ms: number) => new Date(START.getTime() + ms);

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

async function makeLive(opts: { capacity?: number; courseId?: string; starts?: Date; ends?: Date; status?: string } = {}) {
  const instructor = await makeInstructor();
  return db.liveSession.create({
    data: {
      instructor_id: instructor.id,
      course_id: opts.courseId ?? null,
      title: "시험 라이브",
      starts_at: opts.starts ?? START,
      ends_at: opts.ends ?? END,
      capacity: opts.capacity ?? 300,
      status: opts.status ?? "scheduled",
    },
  });
}

describe("라이브 예약", () => {
  it("capacity 300 concurrent", async () => {
    expect(ENTRY_OPENS_BEFORE_MS).toBe(10 * MIN);
    const live = await makeLive({ capacity: 2 });
    const users = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const now = at(-24 * 60 * MIN);
    const results = await Promise.allSettled(users.map((u) => reserveSeat(u.id, live.id, now)));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatchObject({ status: 409, code: "LIVE_FULL", message: "예약이 다 찼어요." });
    expect(await db.liveSeat.count({ where: { session_id: live.id } })).toBe(2);

    // 이미 예약한 사람이 다시 누르면 같은 자리를 돌려준다 (정원이 차 있어도)
    const winner = users[results.findIndex((r) => r.status === "fulfilled")];
    const first = (ok[0] as PromiseFulfilledResult<{ id: string; user_id: string }>).value;
    const again = await reserveSeat(winner.id, live.id, now);
    expect(again.user_id).toBe(winner.id);
    if (first.user_id === winner.id) expect(again.id).toBe(first.id);
    expect(await db.liveSeat.count({ where: { session_id: live.id } })).toBe(2);
  });

  it("same person reserving twice keeps one seat", async () => {
    const live = await makeLive({ capacity: 5 });
    const u = await makeUser();
    const [a, b] = await Promise.all([reserveSeat(u.id, live.id, at(-MIN * 60)), reserveSeat(u.id, live.id, at(-MIN * 60))]);
    expect(a.id).toBe(b.id);
    expect(await db.liveSeat.count({ where: { session_id: live.id } })).toBe(1);
  });

  it("course live needs enrollment", async () => {
    const { course } = await makeCourse();
    const live = await makeLive({ courseId: course.id });
    const outsider = await makeUser();
    await expect(reserveSeat(outsider.id, live.id, at(-60 * MIN))).rejects.toMatchObject({ status: 403 });

    const student = await makeUser();
    await db.enrollment.create({
      data: { user_id: student.id, course_id: course.id, source: "order", starts_at: at(-10 * 24 * 60 * MIN), expires_at: null },
    });
    const seat = await reserveSeat(student.id, live.id, at(-60 * MIN));
    expect(seat.user_id).toBe(student.id);

    // 단독 라이브는 회원이면 누구나
    const open = await makeLive();
    expect((await reserveSeat(outsider.id, open.id, at(-60 * MIN))).user_id).toBe(outsider.id);
  });

  it("cannot reserve ended or cancelled live", async () => {
    const u = await makeUser();
    const ended = await makeLive({ status: "ended" });
    await expect(reserveSeat(u.id, ended.id, at(2 * 60 * MIN))).rejects.toMatchObject({ status: 409 });
    const cancelled = await makeLive({ status: "cancelled" });
    await expect(reserveSeat(u.id, cancelled.id, at(-60 * MIN))).rejects.toMatchObject({ status: 409 });
    await expect(reserveSeat(u.id, "nope", at(-60 * MIN))).rejects.toMatchObject({ status: 404 });
  });
});

describe("라이브 입장", () => {
  it("enter 11 min before → NOT_YET, 10 min before → ok", async () => {
    const live = await makeLive();
    const u = await makeUser();
    await expect(enterLive(u.id, live.id, at(-5 * MIN))).rejects.toMatchObject({ status: 403, code: "NO_SEAT" });
    await reserveSeat(u.id, live.id, at(-60 * MIN));

    await expect(enterLive(u.id, live.id, at(-11 * MIN))).rejects.toMatchObject({
      status: 409,
      code: "NOT_YET",
      message: "입장은 시작 10분 전부터 할 수 있어요.",
    });
    const r = await enterLive(u.id, live.id, at(-10 * MIN));
    expect(r.room_url).toBe(`/live/${live.id}/room`);
    const seat = await db.liveSeat.findUniqueOrThrow({ where: { session_id_user_id: { session_id: live.id, user_id: u.id } } });
    expect(seat.entered_at?.toISOString()).toBe(at(-10 * MIN).toISOString());
  });

  it("ended or cancelled live cannot be entered", async () => {
    const u = await makeUser();
    const live = await makeLive();
    await reserveSeat(u.id, live.id, at(-60 * MIN));
    await db.liveSession.update({ where: { id: live.id }, data: { status: "ended" } });
    await expect(enterLive(u.id, live.id, at(70 * MIN))).rejects.toMatchObject({ status: 409 });
    await db.liveSession.update({ where: { id: live.id }, data: { status: "cancelled" } });
    await expect(enterLive(u.id, live.id, at(0))).rejects.toMatchObject({ status: 409 });
  });
});

describe("라이브 채팅", () => {
  it("chat only after enter", async () => {
    const live = await makeLive();
    const u = await makeUser();
    await reserveSeat(u.id, live.id, at(-60 * MIN));
    await expect(postChat(u.id, live.id, "안녕하세요", at(0))).rejects.toMatchObject({ status: 403 });
    await enterLive(u.id, live.id, at(-5 * MIN));
    const c = await postChat(u.id, live.id, "  안녕하세요  ", at(0));
    expect(c.body).toBe("안녕하세요");
    await expect(postChat(u.id, live.id, "가".repeat(201), at(0))).rejects.toMatchObject({ status: 400 });
    await expect(postChat(u.id, live.id, "   ", at(0))).rejects.toMatchObject({ status: 400 });
    const stranger = await makeUser();
    await expect(postChat(stranger.id, live.id, "끼어들기", at(0))).rejects.toMatchObject({ status: 403 });
  });

  it("chat is rate limited (30 per minute)", async () => {
    const live = await makeLive();
    const u = await makeUser();
    await reserveSeat(u.id, live.id, at(-60 * MIN));
    await enterLive(u.id, live.id, at(-5 * MIN));
    for (let i = 0; i < 30; i++) await postChat(u.id, live.id, `메시지 ${i}`, at(i * 100));
    await expect(postChat(u.id, live.id, "하나 더", at(3_100))).rejects.toMatchObject({ status: 429 });
  });

  it("chatSince returns after id", async () => {
    const live = await makeLive();
    const other = await makeLive();
    const u = await makeUser();
    for (const l of [live, other]) {
      await reserveSeat(u.id, l.id, at(-60 * MIN));
      await enterLive(u.id, l.id, at(-5 * MIN));
    }
    const a = await postChat(u.id, live.id, "하나", at(0));
    await postChat(u.id, other.id, "다른 방", at(0));
    const b = await postChat(u.id, live.id, "둘", at(1000));
    const c = await postChat(u.id, live.id, "셋", at(2000));

    const all = await chatSince(live.id, null);
    expect(all.map((m) => m.body)).toEqual(["하나", "둘", "셋"]);
    const after = await chatSince(live.id, a.id);
    expect(after.map((m) => m.id)).toEqual([b.id, c.id]);
    expect(await chatSince(live.id, c.id)).toEqual([]);
  });
});

describe("라이브 상태·다시보기", () => {
  it("status advances by job", async () => {
    const live = await makeLive();
    const missed = await makeLive({ starts: at(-3 * 60 * MIN), ends: at(-2 * 60 * MIN) });
    const cancelled = await makeLive({ status: "cancelled" });

    expect(await advanceLiveStatus(at(-3 * 60 * MIN - MIN))).toBe(0);
    const before = await runJobsOnce(at(-MIN));
    expect(before.advanceLiveStatus).toBe(1); // 지나간 것만 ended
    expect((await db.liveSession.findUniqueOrThrow({ where: { id: missed.id } })).status).toBe("ended");
    expect((await db.liveSession.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("scheduled");

    const r1 = await runJobsOnce(at(0));
    expect(r1.advanceLiveStatus).toBe(1);
    expect((await db.liveSession.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("live");
    expect((await runJobsOnce(at(MIN))).advanceLiveStatus).toBe(0);

    const r2 = await runJobsOnce(at(60 * MIN));
    expect(r2.advanceLiveStatus).toBe(1);
    expect((await db.liveSession.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("ended");
    expect((await db.liveSession.findUniqueOrThrow({ where: { id: cancelled.id } })).status).toBe("cancelled");
  });

  it("replay attaches lecture with duration", async () => {
    const { course, section, lectures } = await makeCourse({ lectures: [600, 600, 600] });
    const live = await makeLive({ courseId: course.id, status: "ended", ends: new Date(START.getTime() + 90 * MIN) });

    const lecture = await attachReplay("staff:test", live.id, section.id);
    expect(lecture.course_id).toBe(course.id);
    expect(lecture.section_id).toBe(section.id);
    expect(lecture.duration_sec).toBe(90 * 60);
    expect(lecture.sort).toBe(lectures.length + 1);
    expect(JSON.stringify(lecture.script)).toContain("다시보기");
    expect((await db.liveSession.findUniqueOrThrow({ where: { id: live.id } })).replay_lecture_id).toBe(lecture.id);

    // 다시 눌러도 강은 하나
    const again = await attachReplay("staff:test", live.id, section.id);
    expect(again.id).toBe(lecture.id);
    expect(await db.lecture.count({ where: { course_id: course.id } })).toBe(4);
  });

  it("replay needs an ended live and a section of its course", async () => {
    const { course, section } = await makeCourse();
    const { section: otherSection } = await makeCourse();
    const scheduled = await makeLive({ courseId: course.id });
    await expect(attachReplay("staff:test", scheduled.id, section.id)).rejects.toMatchObject({ status: 409 });
    const ended = await makeLive({ courseId: course.id, status: "ended" });
    await expect(attachReplay("staff:test", ended.id, otherSection.id)).rejects.toMatchObject({ status: 400 });
    const standalone = await makeLive({ status: "ended" });
    await expect(attachReplay("staff:test", standalone.id, section.id)).rejects.toMatchObject({ status: 400 });
  });
});
