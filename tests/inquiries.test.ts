import { beforeEach, describe, expect, it } from "vitest";
import { GET as inquiriesGet, POST as inquiriesPost } from "@/app/api/inquiries/route";
import { PATCH as mePatch } from "@/app/api/me/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { db } from "@/server/db";
import { answerInquiry, createInquiry } from "@/server/inquiries";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { loginCookie, makeStaff, makeUser } from "./helpers/fixtures";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

const INQ = { category: "player" as const, title: "재생이 멈춰요", body: "다른 기기에서 재생했다고 나와요. 한 대만 쓰는데요." };

describe("1:1 문의", () => {
  it("create and answer", async () => {
    const user = await makeUser();
    const staff = await makeStaff("cs");
    const q = await createInquiry(user.id, INQ);
    expect(q.status).toBe("open");
    const a = await answerInquiry(`staff:${staff.id}`, q.id, "기기 관리에서 등록 기기를 확인해 주세요.");
    expect(a.status).toBe("answered");
    expect(a.answered_by).toBe(`staff:${staff.id}`);
    expect(a.answered_at).not.toBeNull();
    expect(await db.message.count({ where: { user_id: user.id, kind: "inquiry_answered" } })).toBe(1);
  });

  it("answer unknown inquiry 404", async () => {
    await expect(answerInquiry("staff:x", "nope", "답")).rejects.toMatchObject({ status: 404 });
  });

  it("routes: bad category 400, list only mine, 11th → 429", async () => {
    const user = await makeUser();
    const other = await makeUser();
    await createInquiry(other.id, INQ);
    const cookies = await loginCookie(user.id);
    expect((await call(inquiriesPost, { cookies, body: { ...INQ, category: "weird" } })).status).toBe(400);
    for (let i = 0; i < 10; i++) expect((await call(inquiriesPost, { cookies, body: INQ })).status).toBe(201);
    expect((await call(inquiriesPost, { cookies, body: INQ })).status).toBe(429);
    const list = await call(inquiriesGet, { cookies });
    expect(list.body.inquiries).toHaveLength(10);
  });
});

describe("회원 정보", () => {
  it("PATCH /api/me updates allowed fields only", async () => {
    const user = await makeUser();
    const cookies = await loginCookie(user.id);
    const res = await call(mePatch, {
      method: "PATCH",
      cookies,
      body: { name: "새이름", phone: "010-9876-5432", birth_year: 2001, interests: ["DATA", "LANG"], marketing_opt_in: true, email: "hack@studyon.test" },
    });
    expect(res.status).toBe(200);
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u).toMatchObject({ name: "새이름", phone: "01098765432", birth_year: 2001, interests: ["DATA", "LANG"], marketing_opt_in: true });
    expect(u.email).toBe(user.email);
    expect((await call(mePatch, { method: "PATCH", cookies, body: { phone: "123" } })).status).toBe(400);
    expect((await call(mePatch, { method: "PATCH", body: { name: "x" } })).status).toBe(401);
  });
});
