import { beforeEach, describe, expect, it } from "vitest";
import { GET as getOrderRoute } from "@/app/api/orders/[code]/route";
import { POST as postOrderRoute } from "@/app/api/orders/route";
import { GET as getCartRoute, POST as postCartRoute } from "@/app/api/cart/route";
import { priceOrder } from "@/rules/pricing";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { addToCart, getCart } from "@/server/cart";
import { db } from "@/server/db";
import { activeEnrollment, grantForOrder } from "@/server/enrollments";
import { recordMessage } from "@/server/messages";
import { applyOrderCoupon, cancelPendingOrder, createOrder } from "@/server/orders";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { loginCookie, makeBundle, makeCoupon, makeCourse, makeSubscription, makeUser } from "./helpers/fixtures";

const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

/** 판매 중(할인가 69,000) DEV 강의 + 정가 33,000 CERT 강의. */
async function twoCourses() {
  const a = await makeCourse({ price: 99_000, salePrice: 69_000, saleEndsAt: new Date(Date.now() + 7 * DAY) });
  const b = await makeCourse({ categoryCode: "CERT", price: 33_000 });
  return { a: a.course, b: b.course };
}

describe("주문 만들기", () => {
  it("order totals match priceOrder", async () => {
    const user = await makeUser();
    const { a, b } = await twoCourses();
    await makeCoupon({ code: "TEN", kind: "percent", value: 10 });
    await addToCart(user.id, { course_code: a.code });
    await addToCart(user.id, { course_code: b.code });
    const now = new Date();
    const order = await createOrder(user.id, { coupon_code: "TEN" }, now);

    const expected = priceOrder(
      [
        { key: a.code, category: "DEV", course_code: a.code, instructor_ids: [a.instructor_id], list: 99_000, unit: 69_000 },
        { key: b.code, category: "CERT", course_code: b.code, instructor_ids: [b.instructor_id], list: 33_000, unit: 33_000 },
      ],
      { kind: "percent", value: 10, max_discount: null, min_amount: null, target: "all", target_ref: null },
    );
    expect(order.list_total).toBe(expected.list_total);
    expect(order.discount_total).toBe(expected.discount_total);
    expect(order.coupon_discount).toBe(expected.coupon_discount);
    expect(order.payable).toBe(expected.payable);
    expect(order.payable).toBe(91_800);
    const items = await db.orderItem.findMany({ where: { order_id: order.id }, orderBy: { unit_price: "desc" } });
    expect(items.map((i) => i.paid_amount)).toEqual([62_100, 29_700]);
    expect(items.reduce((s, i) => s + i.paid_amount, 0)).toBe(order.payable);
    expect(items.every((i) => i.paid_amount === i.unit_price - i.coupon_share)).toBe(true);
    expect(order.status).toBe("pending");
    expect(order.expires_at.getTime()).toBe(now.getTime() + 30 * 60_000);
    expect(await db.cartItem.count({ where: { user_id: user.id } })).toBe(0);
  });

  it("code format", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    await addToCart(user.id, { course_code: course.code });
    const order = await createOrder(user.id, {});
    expect(order.code).toMatch(/^SO\d{10}$/);
  });

  it("empty cart 400", async () => {
    const user = await makeUser();
    await expect(createOrder(user.id, {})).rejects.toMatchObject({ status: 400, code: "EMPTY_CART" });
  });

  it("coupon once per user concurrent", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    const coupon = await makeCoupon({ code: "WELCOME10", value: 10, maxDiscount: 10_000, perUserOnce: true });
    await addToCart(user.id, { course_code: course.code });
    const results = await Promise.allSettled([
      createOrder(user.id, { coupon_code: "WELCOME10" }),
      createOrder(user.id, { coupon_code: "WELCOME10" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ status: 409, code: "COUPON_USED" });
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).used_count).toBe(1);
    expect(await db.couponRedemption.count({ where: { coupon_id: coupon.id } })).toBe(1);
  });

  it("coupon total_limit", async () => {
    const { course } = await makeCourse();
    const coupon = await makeCoupon({ code: "ONLYONE", totalLimit: 1 });
    const u1 = await makeUser();
    const u2 = await makeUser();
    await addToCart(u1.id, { course_code: course.code });
    await addToCart(u2.id, { course_code: course.code });
    const results = await Promise.allSettled([
      createOrder(u1.id, { coupon_code: "ONLYONE" }),
      createOrder(u2.id, { coupon_code: "ONLYONE" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ status: 409, code: "COUPON_EXHAUSTED" });
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).used_count).toBe(1);
  });

  it("coupon out of period 400", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    await makeCoupon({ code: "OLD", startsAt: new Date(Date.now() - 10 * DAY), endsAt: new Date(Date.now() - DAY) });
    await addToCart(user.id, { course_code: course.code });
    await expect(createOrder(user.id, { coupon_code: "OLD" })).rejects.toMatchObject({ status: 400, code: "COUPON_EXPIRED" });
    expect(await db.order.count()).toBe(0);
  });

  it("non once-per-person coupon can be used again by the same person", async () => {
    const user = await makeUser();
    const { course: c1 } = await makeCourse();
    const { course: c2 } = await makeCourse();
    const coupon = await makeCoupon({ code: "AGAIN" });
    await addToCart(user.id, { course_code: c1.code });
    await createOrder(user.id, { coupon_code: "AGAIN" });
    await addToCart(user.id, { course_code: c2.code });
    await createOrder(user.id, { coupon_code: "AGAIN" });
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).used_count).toBe(2);
  });

  it("cancel releases coupon", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    const coupon = await makeCoupon({ code: "WELCOME10", value: 10, maxDiscount: 10_000, perUserOnce: true });
    await addToCart(user.id, { course_code: course.code });
    const first = await createOrder(user.id, { coupon_code: "WELCOME10" });
    await db.$transaction((tx) => cancelPendingOrder(tx, first.id, "시험 취소"));
    expect((await db.order.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("cancelled");
    expect(await db.couponRedemption.count({ where: { coupon_id: coupon.id } })).toBe(0);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).used_count).toBe(0);

    await addToCart(user.id, { course_code: course.code });
    const second = await createOrder(user.id, { coupon_code: "WELCOME10" });
    expect(second.coupon_discount).toBe(9900);
  });

  it("coupon can be applied and removed on the order sheet", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    const coupon = await makeCoupon({ code: "WELCOME10", value: 10, maxDiscount: 10_000, perUserOnce: true });
    await addToCart(user.id, { course_code: course.code });
    const order = await createOrder(user.id, {});
    expect(order.payable).toBe(99_000);
    const withCoupon = await applyOrderCoupon(user.id, order.code, "WELCOME10");
    expect(withCoupon.payable).toBe(89_100);
    expect((await db.orderItem.findFirstOrThrow({ where: { order_id: order.id } })).paid_amount).toBe(89_100);
    expect(await db.couponRedemption.count({ where: { coupon_id: coupon.id } })).toBe(1);
    const removed = await applyOrderCoupon(user.id, order.code, null);
    expect(removed.payable).toBe(99_000);
    expect(await db.couponRedemption.count({ where: { coupon_id: coupon.id } })).toBe(0);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).used_count).toBe(0);
  });

  it("already enrolled 409", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    await db.enrollment.create({
      data: { user_id: user.id, course_id: course.id, source: "order", starts_at: new Date(), expires_at: new Date(Date.now() + 100 * DAY) },
    });
    await expect(addToCart(user.id, { course_code: course.code })).rejects.toMatchObject({
      status: 409,
      code: "ALREADY_ENROLLED",
      message: "이미 수강 중인 강의예요.",
    });
  });

  it("price_at honors sale", async () => {
    const end = new Date(Date.now() - 5 * 60_000);
    const { course } = await makeCourse({ price: 99_000, salePrice: 69_000, saleEndsAt: end });
    const late = await makeUser();
    await addToCart(late.id, { course_code: course.code });
    expect((await createOrder(late.id, {})).payable).toBe(99_000);

    const ticketHolder = await makeUser();
    await addToCart(ticketHolder.id, { course_code: course.code });
    const order = await createOrder(ticketHolder.id, { price_at: new Date(end.getTime() - 60_000) });
    expect(order.payable).toBe(69_000);
  });

  it("cart shows priced lines", async () => {
    const user = await makeUser();
    const { a, b } = await twoCourses();
    await addToCart(user.id, { course_code: a.code });
    await addToCart(user.id, { course_code: a.code }); // 같은 강의를 또 담아도 한 줄
    await addToCart(user.id, { course_code: b.code });
    const cart = await getCart(user.id, new Date());
    expect(cart.lines).toHaveLength(2);
    expect(cart.pricing.payable).toBe(102_000);
  });
});

describe("수강권", () => {
  it("grant bundle", async () => {
    const user = await makeUser();
    const cs = [await makeCourse(), await makeCourse(), await makeCourse()].map((c) => c.course);
    const bundle = await makeBundle(cs.map((c) => c.id), { price: 150_000, accessDays: 365 });
    await addToCart(user.id, { bundle_code: bundle.code });
    const order = await createOrder(user.id, {});
    const now = new Date();
    await db.$transaction((tx) => grantForOrder(tx, order.id, now));
    const es = await db.enrollment.findMany({ where: { user_id: user.id } });
    expect(es).toHaveLength(3);
    expect(es.every((e) => e.source === "bundle" && e.status === "active")).toBe(true);
    expect(es.every((e) => e.expires_at?.getTime() === now.getTime() + 365 * DAY)).toBe(true);
  });

  it("grant single course with lifetime access", async () => {
    const user = await makeUser();
    const { course } = await makeCourse({ accessDays: null });
    await addToCart(user.id, { course_code: course.code });
    const order = await createOrder(user.id, {});
    await db.$transaction((tx) => grantForOrder(tx, order.id, new Date()));
    const e = await db.enrollment.findFirstOrThrow({ where: { user_id: user.id } });
    expect(e.source).toBe("order");
    expect(e.expires_at).toBeNull();
  });

  it("grant keeps later expiry", async () => {
    const user = await makeUser();
    const { course: owned } = await makeCourse();
    const { course: other } = await makeCourse();
    const later = new Date(Date.now() + 500 * DAY);
    await db.enrollment.create({ data: { user_id: user.id, course_id: owned.id, source: "order", starts_at: new Date(), expires_at: later } });
    const bundle = await makeBundle([owned.id, other.id], { accessDays: 365 });
    await addToCart(user.id, { bundle_code: bundle.code });
    const order = await createOrder(user.id, {});
    await db.$transaction((tx) => grantForOrder(tx, order.id, new Date()));
    const e = await db.enrollment.findUniqueOrThrow({ where: { user_id_course_id: { user_id: user.id, course_id: owned.id } } });
    expect(e.expires_at?.getTime()).toBe(later.getTime());
    expect(e.status).toBe("active");
  });

  it("subscription enrollment paused not active", async () => {
    const user = await makeUser();
    const { course } = await makeCourse({ inSubscription: true });
    const sub = await makeSubscription(user.id);
    await db.enrollment.create({
      data: { user_id: user.id, course_id: course.id, source: "subscription", subscription_id: sub.id, starts_at: new Date() },
    });
    expect(await activeEnrollment(user.id, course.id, new Date())).not.toBeNull();
    await db.subscription.update({ where: { id: sub.id }, data: { status: "paused" } });
    expect(await activeEnrollment(user.id, course.id, new Date())).toBeNull();
    await db.subscription.update({ where: { id: sub.id }, data: { status: "past_due" } });
    expect(await activeEnrollment(user.id, course.id, new Date())).not.toBeNull();
  });

  it("expired enrollment is not active", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    await db.enrollment.create({
      data: { user_id: user.id, course_id: course.id, source: "order", starts_at: new Date(Date.now() - 10 * DAY), expires_at: new Date(Date.now() - DAY) },
    });
    expect(await activeEnrollment(user.id, course.id, new Date())).toBeNull();
  });
});

describe("보낸 편지함", () => {
  it("recordMessage prefixes the brand", async () => {
    const user = await makeUser();
    await db.$transaction((tx) => recordMessage(tx, user, "test", "제목", "본문이에요."));
    const m = await db.message.findFirstOrThrow({ where: { user_id: user.id } });
    expect(m.body).toBe("[스터디온에듀] 본문이에요.");
    expect(m.to).toBe(user.email);
  });
});

describe("API", () => {
  it("cart and order need login", async () => {
    expect((await call(getCartRoute)).status).toBe(401);
    expect((await call(postOrderRoute, { body: {} })).status).toBe(401);
  });

  it("cart → order → order is owner only", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    const cookies = await loginCookie(user.id);
    expect((await call(postCartRoute, { cookies, body: { course_code: course.code } })).status).toBe(201);
    const r = await call(postOrderRoute, { cookies, body: {} });
    expect(r.status).toBe(201);
    expect(r.body.order.code).toMatch(/^SO\d{10}$/);
    const mine = await call(getOrderRoute, { cookies, params: { code: r.body.order.code } });
    expect(mine.status).toBe(200);
    expect(mine.body.order.payable).toBe(99_000);
    const other = await makeUser();
    const theirs = await call(getOrderRoute, { cookies: await loginCookie(other.id), params: { code: r.body.order.code } });
    expect(theirs.status).toBe(404);
  });

  it("route ignores price_at from the browser", async () => {
    const end = new Date(Date.now() - 5 * 60_000);
    const { course } = await makeCourse({ price: 99_000, salePrice: 69_000, saleEndsAt: end });
    const user = await makeUser();
    const cookies = await loginCookie(user.id);
    await call(postCartRoute, { cookies, body: { course_code: course.code } });
    const r = await call(postOrderRoute, { cookies, body: { price_at: new Date(end.getTime() - 60_000).toISOString() } });
    expect(r.body.order.payable).toBe(99_000);
  });

  it("checkout rate limit", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    const cookies = await loginCookie(user.id);
    await call(postCartRoute, { cookies, body: { course_code: course.code } });
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await call(postOrderRoute, { cookies, body: {} })).status);
    expect(statuses[0]).toBe(201);
    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
  });
});
