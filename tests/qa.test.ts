import { beforeEach, describe, expect, it } from "vitest";
import { POST as answerRoute } from "@/app/api/questions/[id]/answers/route";
import { GET as questionsGet, POST as questionsPost } from "@/app/api/questions/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { INSTRUCTOR_COOKIE, STAFF_COOKIE, issueInstructorSession, issueStaffSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { answerQuestion, askQuestion, listQuestions } from "@/server/qa";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { loginCookie, makeCourse, makeInstructor, makeStaff, makeUser } from "./helpers/fixtures";

const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

async function setup() {
  const instructor = await makeInstructor();
  const { course, lectures } = await makeCourse({ instructorId: instructor.id });
  const user = await makeUser();
  await db.enrollment.create({ data: { user_id: user.id, course_id: course.id, source: "free", starts_at: new Date(), expires_at: null } });
  return { instructor, course, lectures, user };
}

const Q = { title: "반복문이 헷갈려요", body: "for와 while을 언제 나눠 써야 하나요?" };

describe("질문·답변", () => {
  it("ask needs enrollment 403", async () => {
    const { lectures } = await setup();
    const other = await makeUser();
    await expect(askQuestion(other.id, { lecture_id: lectures[0].id, ...Q }, new Date())).rejects.toMatchObject({ status: 403 });
    const res = await call(questionsPost, { cookies: await loginCookie(other.id), body: { lecture_id: lectures[0].id, ...Q } });
    expect(res.status).toBe(403);
    expect(await db.question.count()).toBe(0);
  });

  it("ask stores course and lecture", async () => {
    const { course, lectures, user } = await setup();
    const q = await askQuestion(user.id, { lecture_id: lectures[1].id, ...Q }, new Date());
    expect(q.course_id).toBe(course.id);
    expect(q.lecture_id).toBe(lectures[1].id);
    expect(q.answered_at).toBeNull();
    const res = await call(questionsGet, { cookies: await loginCookie(user.id), url: `http://localhost/api/questions?lecture_id=${lectures[1].id}` });
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].mine).toBe(true);
  });

  it("instructor answers own only", async () => {
    const { instructor, lectures, user } = await setup();
    const stranger = await makeInstructor();
    const now = new Date();
    const q = await askQuestion(user.id, { lecture_id: lectures[0].id, ...Q }, now);
    await expect(answerQuestion({ kind: "instructor", id: stranger.id }, q.id, "제가 답해 볼게요.", now)).rejects.toMatchObject({ status: 403 });
    const a = await answerQuestion({ kind: "instructor", id: instructor.id }, q.id, "목록을 돌 때는 for를 써요.", now);
    expect(a.author_kind).toBe("instructor");
    expect((await db.question.findUniqueOrThrow({ where: { id: q.id } })).answered_at).toEqual(now);
    expect(await db.message.count({ where: { user_id: user.id, kind: "question_answered" } })).toBe(1);
  });

  it("answer route: instructor cookie (own course) and staff cookie", async () => {
    const { instructor, lectures, user } = await setup();
    const q = await askQuestion(user.id, { lecture_id: lectures[0].id, ...Q }, new Date());
    const iu = await db.instructorUser.create({ data: { email: `iu${Date.now()}@studyon.test`, password_hash: "scrypt$test", instructor_id: instructor.id } });
    const ires = await call(answerRoute, { cookies: { [INSTRUCTOR_COOKIE]: await issueInstructorSession(iu.id) }, params: { id: q.id }, body: { body: "강사 답변이에요." } });
    expect(ires.status).toBe(201);
    const staff = await makeStaff("cs");
    const sres = await call(answerRoute, { cookies: { [STAFF_COOKIE]: await issueStaffSession(staff.id) }, params: { id: q.id }, body: { body: "운영팀 답변이에요." } });
    expect(sres.status).toBe(201);
    const content = await makeStaff("content");
    const denied = await call(answerRoute, { cookies: { [STAFF_COOKIE]: await issueStaffSession(content.id) }, params: { id: q.id }, body: { body: "권한 없는 답변" } });
    expect(denied.status).toBe(403);
    const anon = await call(answerRoute, { params: { id: q.id }, body: { body: "누구세요" } });
    expect(anon.status).toBe(401);
    expect(await db.answer.count({ where: { question_id: q.id } })).toBe(2);
  });

  it("overdue flag after 7 days", async () => {
    const { course, lectures, user } = await setup();
    const now = new Date();
    const old = await askQuestion(user.id, { lecture_id: lectures[0].id, ...Q }, new Date(now.getTime() - 8 * DAY));
    const fresh = await askQuestion(user.id, { lecture_id: lectures[0].id, ...Q }, new Date(now.getTime() - 6 * DAY));
    const list = await listQuestions({ courseIds: [course.id] }, now);
    expect(list.find((x) => x.id === old.id)?.overdue).toBe(true);
    expect(list.find((x) => x.id === fresh.id)?.overdue).toBe(false);
  });

  it("answer clears overdue", async () => {
    const { instructor, course, lectures, user } = await setup();
    const now = new Date();
    const q = await askQuestion(user.id, { lecture_id: lectures[0].id, ...Q }, new Date(now.getTime() - 8 * DAY));
    await answerQuestion({ kind: "instructor", id: instructor.id }, q.id, "늦었지만 답해요.", now);
    const list = await listQuestions({ courseIds: [course.id] }, now);
    expect(list.find((x) => x.id === q.id)?.overdue).toBe(false);
    expect(await listQuestions({ courseIds: [course.id], unansweredOnly: true }, now)).toHaveLength(0);
  });

  it("11th question in 10 min → 429", async () => {
    const { lectures, user } = await setup();
    const cookies = await loginCookie(user.id);
    for (let i = 0; i < 10; i++) {
      const r = await call(questionsPost, { cookies, body: { lecture_id: lectures[0].id, ...Q } });
      expect(r.status).toBe(201);
    }
    const r = await call(questionsPost, { cookies, body: { lecture_id: lectures[0].id, ...Q } });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
    expect(r.body.error.retry_at).toBeTruthy();
    expect(await db.question.count()).toBe(10);
  });
});
