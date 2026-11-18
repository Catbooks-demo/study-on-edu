import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminQueue } from "@/app/api/admin/ops/queue/route";
import { GET as pollRoute } from "@/app/api/queue/[ticketId]/route";
import { POST as joinRoute } from "@/app/api/queue/join/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { STAFF_COOKIE, issueStaffSession } from "@/server/auth/session";
import { addToCart } from "@/server/cart";
import { db } from "@/server/db";
import { createOrder } from "@/server/orders";
import {
  admitCookieName,
  advance,
  gate,
  getSetting,
  join,
  poll,
  queueHousekeeping,
  queueStats,
  resetQueueCache,
  signAdmit,
  updateSetting,
  verifyAdmit,
} from "@/server/queue";
import { resetDb } from "./helpers/db";
import { makeCourse, makeStaff, makeUser } from "./helpers/fixtures";
import { call } from "./helpers/http";

const T0 = new Date("2026-12-01T03:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  resetQueueCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const withCookie = (name: string, value: string) => new Request("http://localhost/x", { headers: { cookie: `${name}=${encodeURIComponent(value)}` } });

describe("대기열", () => {
  it("disabled passes (기본은 꺼짐)", async () => {
    expect(await getSetting("site")).toBeNull();
    expect(await gate(new Request("http://localhost/"), "site", T0)).toMatchObject({ pass: true });
    expect(await gate(new Request("http://localhost/"), "checkout:d30", T0)).toMatchObject({ pass: true });
  });

  it("over rate gets ticket", async () => {
    await updateSetting("system", "site", { enabled: true, rate_per_sec: 1 });
    const tickets = [];
    for (let i = 0; i < 5; i++) tickets.push(await join("site", T0));
    expect(tickets.map((t) => t.status)).toEqual(["admitted", "waiting", "waiting", "waiting", "waiting"]);
    const polled = [];
    for (const t of tickets.slice(1)) polled.push(await poll(t.id, T0));
    expect(polled.map((p) => p.ahead)).toEqual([0, 1, 2, 3]);
    expect(polled.every((p) => p.status === "waiting" && !p.admit_token)).toBe(true);
  });

  it("poll admits in order", async () => {
    await updateSetting("system", "site", { enabled: true, rate_per_sec: 1 });
    const tickets = [];
    for (let i = 0; i < 5; i++) tickets.push(await join("site", T0));
    const p = await poll(tickets[4].id, at(2000));
    expect(p.status).toBe("waiting");
    expect(p.ahead).toBe(1);
    const rows = await db.queueTicket.findMany({ where: { target: "site" }, orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["admitted", "admitted", "admitted", "waiting", "waiting"]);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    const p2 = await poll(tickets[1].id, at(2000));
    expect(p2.status).toBe("admitted");
    expect(p2.admit_token).toBeTruthy();
    expect(verifyAdmit(p2.admit_token!, "site", at(2000))).toMatchObject({ ticket_id: tickets[1].id });
  });

  it("concurrent advance no double admit", async () => {
    await updateSetting("system", "site", { enabled: true, rate_per_sec: 3 });
    for (let i = 0; i < 20; i++) await join("site", T0);
    const before = await db.queueTicket.count({ where: { status: "admitted" } });
    const ns = await Promise.all([1, 2, 3, 4, 5].map(() => advance("site", at(2000))));
    const after = await db.queueTicket.count({ where: { status: "admitted" } });
    expect(ns.reduce((a, b) => a + b, 0)).toBe(after - before);
    expect(after - before).toBe(6); // 2초 × 3명
  });

  it("forged cookie rejected", async () => {
    await updateSetting("system", "site", { enabled: true, rate_per_sec: 1 });
    await join("site", T0); // 이번 1초 몫을 다 씀
    const real = signAdmit("tkt", "site", at(600_000));
    const forged = `${real.slice(0, -3)}abc`;
    expect(verifyAdmit(forged, "site", T0)).toBeNull();
    expect(verifyAdmit(real, "checkout:x", T0)).toBeNull(); // 다른 대상
    const g = await gate(withCookie(admitCookieName("site"), forged), "site", T0);
    expect(g.pass).toBe(false);
    const ok = await gate(withCookie(admitCookieName("site"), real), "site", T0);
    expect(ok.pass).toBe(true);
  });

  it("expired admit token re-queues", async () => {
    await updateSetting("system", "site", { enabled: true, rate_per_sec: 1 });
    await join("site", T0);
    const expired = signAdmit("tkt", "site", at(-1));
    expect(verifyAdmit(expired, "site", T0)).toBeNull();
    const g = await gate(withCookie(admitCookieName("site"), expired), "site", T0);
    expect(g.pass).toBe(false);
    if (!g.pass) expect((await db.queueTicket.findUniqueOrThrow({ where: { id: g.ticket_id } })).status).toBe("waiting");
  });

  it("stale ticket expires after 60s", async () => {
    await updateSetting("system", "site", { enabled: true, rate_per_sec: 1 });
    await join("site", T0);
    const w = await join("site", T0);
    // 59초에는 아직 만료 전이다 (그 사이 몫으로 입장될 수 있어 다시 대기로 돌려놓는다). 61초 동안 새로고침이 없으면 만료
    await queueHousekeeping(at(59_000 - 1));
    expect((await db.queueTicket.findUniqueOrThrow({ where: { id: w.id } })).status).not.toBe("expired");
    await db.queueTicket.update({ where: { id: w.id }, data: { status: "waiting", admitted_at: null, expires_at: null } });
    await queueHousekeeping(at(61_000));
    expect((await db.queueTicket.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("expired");
    expect((await poll(w.id, at(62_000))).status).toBe("expired");
  });

  it("deadline extension", async () => {
    const saleEnd = at(60_000);
    const { course } = await makeCourse({ price: 100_000, salePrice: 70_000, saleEndsAt: saleEnd });
    await updateSetting("system", "checkout:d30", { enabled: true, rate_per_sec: 1, course_codes: [course.code] });
    const ticket = await join("checkout:d30", T0); // 마감 1분 전 발급
    const u1 = await makeUser();
    await addToCart(u1.id, { course_code: course.code }, T0);
    const o1 = await createOrder(u1.id, { held_at: ticket.issued_at }, at(60_000 + 20 * 60_000));
    expect(o1.payable).toBe(70_000);
    const u2 = await makeUser();
    await addToCart(u2.id, { course_code: course.code }, T0);
    const o2 = await createOrder(u2.id, { held_at: ticket.issued_at }, at(60_000 + 31 * 60_000));
    expect(o2.payable).toBe(100_000);
  });

  it("live auto-enabled 10 min before", async () => {
    const starts = at(30 * 60_000);
    const live = await db.liveSession.create({
      data: { title: "시험 라이브", starts_at: starts, ends_at: at(90 * 60_000), capacity: 100, instructor_id: (await makeCourse()).course.instructor_id },
    });
    const target = `live:${live.id}`;
    await queueHousekeeping(at(19 * 60_000));
    resetQueueCache();
    expect((await getSetting(target))?.enabled ?? false).toBe(false);
    await queueHousekeeping(at(20 * 60_000));
    resetQueueCache();
    const s = await getSetting(target);
    expect(s?.enabled).toBe(true);
    expect(s?.rate_per_sec).toBe(20);
    await queueHousekeeping(at(91 * 60_000));
    resetQueueCache();
    expect((await getSetting(target))?.enabled).toBe(false);
  });

  it("queueStats counts waiting and recent admissions", async () => {
    await updateSetting("system", "site", { enabled: true, rate_per_sec: 1 });
    for (let i = 0; i < 3; i++) await join("site", T0);
    const s = await queueStats("site", T0);
    expect(s.waiting).toBe(2);
    expect(s.admitted_last_min).toBe(1);
  });

  it("join·poll API sets HttpOnly admit cookie, admin API is admin-only and audited", async () => {
    const admin = await makeStaff("admin");
    const cs = await makeStaff("cs");
    const adminCookie = { [STAFF_COOKIE]: await issueStaffSession(admin.id) };
    const csCookie = { [STAFF_COOKIE]: await issueStaffSession(cs.id) };
    expect((await call(adminQueue, { body: { target: "site", enabled: true, rate_per_sec: 1 }, cookies: csCookie })).status).toBe(403);
    expect((await call(adminQueue, { body: { target: "site", enabled: true, rate_per_sec: 0 }, cookies: adminCookie })).status).toBe(400);
    expect((await call(adminQueue, { body: { target: "bad target", enabled: true, rate_per_sec: 1 }, cookies: adminCookie })).status).toBe(400);
    expect((await call(adminQueue, { body: { target: "site", enabled: true, rate_per_sec: 1 }, cookies: adminCookie })).status).toBe(200);
    expect(await db.auditLog.count({ where: { action: "queue.update" } })).toBe(1);
    resetQueueCache();

    // 꺼진 대상에는 줄 설 수 없다
    expect((await call(joinRoute, { body: { target: "checkout:nope" } })).status).toBe(409);

    const first = await call<{ ticket_id: string; status: string }>(joinRoute, { body: { target: "site" } });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("admitted");
    const name = admitCookieName("site");
    expect(first.cookie(name)).toBeTruthy();
    const line = first.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))!;
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Max-Age=600/);

    const second = await call<{ ticket_id: string; status: string; ahead: number }>(joinRoute, { body: { target: "site" } });
    expect(second.body.status).toBe("waiting");
    expect(second.cookie(name)).toBeUndefined();
    const p = await call<{ status: string }>(pollRoute, { params: { ticketId: second.body.ticket_id } });
    expect(p.status).toBe(200);
    expect(["waiting", "admitted"]).toContain(p.body.status);
    expect((await call(pollRoute, { params: { ticketId: "nope" } })).status).toBe(404);
  });
});
