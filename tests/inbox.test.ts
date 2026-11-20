import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as myCouponsRoute } from "@/app/api/me/coupons/route";
import { POST as readRoute } from "@/app/api/me/inbox/read/route";
import { GET as inboxRoute } from "@/app/api/me/inbox/route";
import { POST as grantRoute } from "@/app/api/v1/coupons/[code]/grants/route";
import { POST as createCouponV1 } from "@/app/api/v1/coupons/route";
import { POST as inboxV1 } from "@/app/api/v1/inbox/route";
import { issueApiKey } from "@/server/apikeys";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { addToCart } from "@/server/cart";
import { grantCoupon, myCoupons } from "@/server/couponbox";
import { db } from "@/server/db";
import { markRead, sendInbox, unreadCount } from "@/server/inbox";
import { applyOrderCoupon, createOrder } from "@/server/orders";
import { resetModeCache } from "@/server/servicemode";
import { resetDb } from "./helpers/db";
import { loginCookie, makeCoupon, makeCourse, makeUser } from "./helpers/fixtures";
import { call } from "./helpers/http";

const DAY = 86_400_000;
const auth = (key: string) => ({ authorization: `Bearer ${key}` });

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  resetModeCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

async function privateCoupon(code = "ONLYYOU") {
  return db.coupon.update({ where: { id: (await makeCoupon({ code, value: 20, perUserOnce: true })).id }, data: { private: true } });
}

describe("받은 회원만 쓰는 쿠폰", () => {
  it("someone without it in the box gets 403 COUPON_NOT_YOURS", async () => {
    const [owner, other] = [await makeUser(), await makeUser()];
    const { course } = await makeCourse();
    await privateCoupon();
    await grantCoupon("ONLYYOU", [owner.id], "api");

    await addToCart(other.id, { course_code: course.code });
    await expect(createOrder(other.id, { coupon_code: "ONLYYOU" })).rejects.toMatchObject({ status: 403, code: "COUPON_NOT_YOURS" });
    const plain = await createOrder(other.id, {});
    await expect(applyOrderCoupon(other.id, plain.code, "ONLYYOU")).rejects.toMatchObject({ status: 403, code: "COUPON_NOT_YOURS" });

    await addToCart(owner.id, { course_code: course.code });
    const mine = await createOrder(owner.id, { coupon_code: "ONLYYOU" });
    expect(mine.coupon_discount).toBeGreaterThan(0);
  });

  it("box shows usable, then used after an order, and expired", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    await privateCoupon("USEME");
    await makeCoupon({ code: "OLDONE", startsAt: new Date(Date.now() - 10 * DAY), endsAt: new Date(Date.now() + DAY) });
    await grantCoupon("USEME", [user.id], "api");
    await grantCoupon("OLDONE", [user.id], "admin");
    expect(Object.fromEntries((await myCoupons(user.id)).map((c) => [c.code, c.state]))).toEqual({ OLDONE: "usable", USEME: "usable" });

    await addToCart(user.id, { course_code: course.code });
    await createOrder(user.id, { coupon_code: "USEME" });
    const later = new Date(Date.now() + 2 * DAY);
    const states = Object.fromEntries((await myCoupons(user.id, later)).map((c) => [c.code, c.state]));
    expect(states).toEqual({ USEME: "used", OLDONE: "expired" });
  });
});

describe("쿠폰함 발급 (외부 API)", () => {
  it("grant is idempotent, adds one inbox message per new member, reports unknown ids, audits", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const w = await issueApiKey("AXcellent", ["read", "write"]);
    await privateCoupon("SORRY5000");

    const first = await call<{ granted: string[]; already: string[]; not_found: string[] }>(grantRoute, {
      headers: auth(w.key),
      params: { code: "sorry5000" },
      body: { member_ids: [a.id, "nobody", a.id] },
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ granted: [a.id], already: [], not_found: ["nobody"] });

    const second = await call<{ granted: string[]; already: string[] }>(grantRoute, {
      headers: auth(w.key),
      params: { code: "SORRY5000" },
      body: { member_ids: [a.id, b.id], message: { title: "불편을 드려 죄송해요", body: "보상 쿠폰을 넣어 두었어요." } },
    });
    expect(second.body).toMatchObject({ granted: [b.id], already: [a.id] });

    expect(await db.userCoupon.count()).toBe(2);
    const msgs = await db.inboxMessage.findMany({ orderBy: { created_at: "asc" } });
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => m.kind === "coupon" && m.source === "api" && m.link === "/my/coupons" && m.coupon_id)).toBe(true);
    expect(msgs.find((m) => m.user_id === b.id)?.title).toBe("불편을 드려 죄송해요");
    expect(await db.auditLog.count({ where: { actor: "api:AXcellent", action: "coupon.grant" } })).toBe(2);
  });

  it("grant needs write, refuses unknown/off/expired/referral coupons", async () => {
    const u = await makeUser();
    const r = await issueApiKey("읽기", ["read"]);
    const w = await issueApiKey("쓰기", ["write"]);
    await makeCoupon({ code: "LIVE1" });
    expect((await call(grantRoute, { headers: auth(r.key), params: { code: "LIVE1" }, body: { member_ids: [u.id] } })).status).toBe(403);
    expect((await call(grantRoute, { headers: auth(w.key), params: { code: "LIVE1" }, body: { member_ids: [] } })).status).toBe(400);
    expect((await call(grantRoute, { headers: auth(w.key), params: { code: "NONE" }, body: { member_ids: [u.id] } })).status).toBe(404);

    const off = await makeCoupon({ code: "OFF1" });
    await db.coupon.update({ where: { id: off.id }, data: { active: false } });
    expect((await call(grantRoute, { headers: auth(w.key), params: { code: "OFF1" }, body: { member_ids: [u.id] } })).status).toBe(409);
    await makeCoupon({ code: "PAST1", startsAt: new Date(Date.now() - 10 * DAY), endsAt: new Date(Date.now() - DAY) });
    expect((await call(grantRoute, { headers: auth(w.key), params: { code: "PAST1" }, body: { member_ids: [u.id] } })).status).toBe(400);
    await makeCoupon({ code: "REF-X", referral: true });
    expect((await call(grantRoute, { headers: auth(w.key), params: { code: "REF-X" }, body: { member_ids: [u.id] } })).status).toBe(400);
    expect(await db.userCoupon.count()).toBe(0);
    expect(await db.inboxMessage.count()).toBe(0);
  });

  it("v1 coupon create with private forces once per member", async () => {
    const w = await issueApiKey("마케팅", ["write"]);
    const body = { code: "VIP10", kind: "percent", value: 10, private: true, starts_at: "2026-12-01T00:00:00Z", ends_at: "2026-12-31T15:00:00Z" };
    const r = await call<{ coupon: { private: boolean; per_user_once: boolean } }>(createCouponV1, { headers: auth(w.key), body });
    expect(r.status).toBe(201);
    expect(r.body.coupon).toMatchObject({ private: true, per_user_once: true });
    expect((await db.coupon.findUniqueOrThrow({ where: { code: "VIP10" } })).per_user_once).toBe(true);
  });
});

describe("메시지함", () => {
  it("v1 inbox send: write only, site paths only, skips unknown members, audits", async () => {
    const u = await makeUser();
    const r = await issueApiKey("읽기", ["read"]);
    const w = await issueApiKey("AXcellent", ["write"]);
    const body = { member_ids: [u.id, "ghost"], title: "문의 답변이 등록됐어요", body: "마이페이지 1:1 문의에서 확인해 주세요.", link: "/my/inquiries" };
    expect((await call(inboxV1, { headers: auth(r.key), body })).status).toBe(403);
    expect((await call(inboxV1, { headers: auth(w.key), body: { ...body, link: "https://evil.example/x" } })).status).toBe(400);
    expect((await call(inboxV1, { headers: auth(w.key), body: { ...body, link: "//evil.example" } })).status).toBe(400);
    expect((await call(inboxV1, { headers: auth(w.key), body: { ...body, title: " " } })).status).toBe(400);
    const ok = await call<{ sent: number; not_found: string[] }>(inboxV1, { headers: auth(w.key), body });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ sent: 1, not_found: ["ghost"] });
    const m = await db.inboxMessage.findFirstOrThrow({ where: { user_id: u.id } });
    expect(m).toMatchObject({ kind: "notice", source: "api", link: "/my/inquiries", read_at: null });
    expect(await db.auditLog.count({ where: { actor: "api:AXcellent", action: "inbox.send" } })).toBe(1);
  });

  it("members see only their own messages and coupons; read marks only their own", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    await db.$transaction(async (tx) => {
      await sendInbox(tx, [me.id], { kind: "notice", title: "하나", body: "첫 안내" }, "site");
      await sendInbox(tx, [me.id], { kind: "notice", title: "둘", body: "둘째 안내" }, "site");
      await sendInbox(tx, [other.id], { kind: "notice", title: "남의 것", body: "다른 회원 안내" }, "site");
    });
    await makeCoupon({ code: "OTHERS" });
    await grantCoupon("OTHERS", [other.id], "admin");

    const cookies = await loginCookie(me.id);
    const list = await call<{ messages: { id: string; title: string; read: boolean }[]; unread: number }>(inboxRoute, { cookies });
    expect(list.status).toBe(200);
    expect(list.body.unread).toBe(2);
    expect(list.body.messages.map((m) => m.title).sort()).toEqual(["둘", "하나"]);

    const theirs = await db.inboxMessage.findFirstOrThrow({ where: { user_id: other.id } });
    const one = list.body.messages[0];
    const r1 = await call<{ changed: number; unread: number }>(readRoute, { cookies, body: { ids: [one.id, theirs.id] } });
    expect(r1.body).toEqual({ changed: 1, unread: 1 });
    expect((await db.inboxMessage.findUniqueOrThrow({ where: { id: theirs.id } })).read_at).toBeNull();

    const r2 = await call<{ changed: number; unread: number }>(readRoute, { cookies, body: {} });
    expect(r2.body).toEqual({ changed: 1, unread: 0 });
    expect(await unreadCount(other.id)).toBe(2); // 남의 메시지(안내 1 + 쿠폰 도착 1)는 그대로
    expect(await markRead(me.id, null)).toBe(0);

    const box = await call<{ coupons: unknown[] }>(myCouponsRoute, { cookies });
    expect(box.body.coupons).toEqual([]);
    expect((await call(inboxRoute, {})).status).toBe(401);
  });
});
