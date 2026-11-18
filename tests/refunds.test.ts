import { beforeEach, describe, expect, it } from "vitest";
import { POST as approveRoute } from "@/app/api/admin/refunds/[id]/approve/route";
import { GET as previewRoute } from "@/app/api/refunds/preview/route";
import { POST as requestRoute } from "@/app/api/refunds/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { STAFF_COOKIE, issueStaffSession } from "@/server/auth/session";
import { addToCart } from "@/server/cart";
import { db } from "@/server/db";
import { createOrder } from "@/server/orders";
import { mockPay } from "@/server/payments";
import { approveRefund, previewRefund, rejectRefund, requestRefund } from "@/server/refunds";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { loginCookie, makeBundle, makeCourse, makeStaff, makeUser } from "./helpers/fixtures";

const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

/** paidAt에 장바구니 → 주문 → 모의 결제. */
async function buy(userId: string, target: { course_code?: string; bundle_code?: string }[], paidAt: Date) {
  for (const t of target) await addToCart(userId, t, paidAt);
  const order = await createOrder(userId, {}, paidAt);
  await mockPay(order.code, paidAt);
  const items = await db.orderItem.findMany({ where: { order_id: order.id }, orderBy: { unit_price: "desc" } });
  return { order, items };
}

async function boughtCourse(paidDaysAgo = 3) {
  const now = new Date();
  const user = await makeUser();
  const { course, lectures } = await makeCourse({ price: 99_000, lectures: [600, 600, 600, 600, 600, 600, 600, 600, 600, 600] });
  const { order, items } = await buy(user.id, [{ course_code: course.code }], new Date(now.getTime() - paidDaysAgo * DAY));
  return { now, user, course, lectures, order, item: items[0] };
}

describe("환불 신청·승인", () => {
  it("full refund within 7 days", async () => {
    const { now, user, course, order, item } = await boughtCourse(3);
    const staff = await makeStaff("cs");
    const r = await requestRefund(user.id, item.id, "단순 변심", now);
    expect(r.status).toBe("requested");
    expect(r.amount).toBe(99_000);
    expect(r.calc_amount).toBe(99_000);
    expect((r.basis as { kind: string }).kind).toBe("full");

    const done = await approveRefund(r.id, staff.id, {}, now);
    expect(done.status).toBe("done");
    const rows = await db.payment.findMany({ where: { order_id: order.id, kind: "refund", status: "approved" } });
    expect(rows.reduce((s, p) => s + p.amount, 0)).toBe(item.paid_amount);
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("refunded");
    expect(o.refunded_amount).toBe(99_000);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("refunded");
    const e = await db.enrollment.findUniqueOrThrow({ where: { user_id_course_id: { user_id: user.id, course_id: course.id } } });
    expect(e.status).toBe("refunded");
    expect(await db.auditLog.count({ where: { target: `refund:${r.id}` } })).toBe(1);
    expect(await db.message.count({ where: { user_id: user.id, kind: "refund_done" } })).toBe(1);
  });

  it("prorated uses watched progress", async () => {
    const { now, user, course, lectures, item } = await boughtCourse(10);
    // 10강 중 1강을 끝까지 봤다: 진도 10%
    await db.lectureProgress.create({ data: { user_id: user.id, lecture_id: lectures[0].id, course_id: course.id, watched_sec: 600 } });
    const q = await previewRefund(user.id, item.id, now);
    expect(q.kind).toBe("prorated");
    expect(q.refund).toBe(89_100);
    const r = await requestRefund(user.id, item.id, "진도가 맞지 않아요", now);
    expect(r.amount).toBe(89_100);
  });

  it("partial order", async () => {
    const now = new Date();
    const user = await makeUser();
    const { course: a } = await makeCourse({ price: 99_000 });
    const { course: b } = await makeCourse({ price: 33_000 });
    const { order, items } = await buy(user.id, [{ course_code: a.code }, { course_code: b.code }], new Date(now.getTime() - DAY));
    const staff = await makeStaff("cs");
    const r = await requestRefund(user.id, items[1].id, "하나만 환불", now);
    await approveRefund(r.id, staff.id, {}, now);
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("partially_refunded");
    expect(o.refunded_amount).toBe(33_000);
    const kept = await db.enrollment.findUniqueOrThrow({ where: { user_id_course_id: { user_id: user.id, course_id: a.id } } });
    expect(kept.status).toBe("active");
  });

  it("bundle whole", async () => {
    const now = new Date();
    const user = await makeUser();
    const cs = [await makeCourse(), await makeCourse(), await makeCourse()].map((c) => c.course);
    const bundle = await makeBundle(cs.map((c) => c.id), { price: 150_000 });
    const { order, items } = await buy(user.id, [{ bundle_code: bundle.code }], new Date(now.getTime() - DAY));
    const staff = await makeStaff("cs");
    const r = await requestRefund(user.id, items[0].id, "패키지 환불", now);
    expect(r.amount).toBe(150_000);
    await approveRefund(r.id, staff.id, {}, now);
    const es = await db.enrollment.findMany({ where: { user_id: user.id } });
    expect(es).toHaveLength(3);
    expect(es.every((e) => e.status === "refunded")).toBe(true);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("refunded");
  });

  it("adjust needs reason", async () => {
    const { now, user, item } = await boughtCourse(3);
    const staff = await makeStaff("cs");
    const r = await requestRefund(user.id, item.id, "변심", now);
    await expect(approveRefund(r.id, staff.id, { amount: 50_000 }, now)).rejects.toMatchObject({
      status: 400,
      code: "REASON_REQUIRED",
      message: "금액을 바꾸면 사유를 적어 주세요.",
    });
    expect((await db.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("requested");
    await expect(approveRefund(r.id, staff.id, { amount: 100_000, reason: "더 많이" }, now)).rejects.toMatchObject({ status: 400 });
    const done = await approveRefund(r.id, staff.id, { amount: 50_000, reason: "강사와 협의한 금액" }, now);
    expect(done.status).toBe("done");
    expect(done.amount).toBe(50_000);
    expect(done.adjust_reason).toBe("강사와 협의한 금액");
  });

  it("concurrent request once", async () => {
    const { now, user, item } = await boughtCourse(3);
    const results = await Promise.allSettled([
      requestRefund(user.id, item.id, "한 번", now),
      requestRefund(user.id, item.id, "두 번", now),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ status: 409, code: "REFUND_OPEN", message: "이미 환불 신청이 들어가 있어요." });
    expect(await db.refund.count({ where: { order_item_id: item.id } })).toBe(1);
  });

  it("concurrent approve refunds once", async () => {
    const { now, user, order, item } = await boughtCourse(3);
    const s1 = await makeStaff("cs");
    const s2 = await makeStaff("admin");
    const r = await requestRefund(user.id, item.id, "변심", now);
    const results = await Promise.allSettled([approveRefund(r.id, s1.id, {}, now), approveRefund(r.id, s2.id, {}, now)]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ status: 409 });
    expect(await db.payment.count({ where: { order_id: order.id, kind: "refund" } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).refunded_amount).toBe(99_000);
    expect((await db.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("done");
  });

  it("rejected then can request again", async () => {
    const { now, user, item } = await boughtCourse(3);
    const staff = await makeStaff("cs");
    const r = await requestRefund(user.id, item.id, "변심", now);
    const rejected = await rejectRefund(r.id, staff.id, "확인이 더 필요해요");
    expect(rejected.status).toBe("rejected");
    await expect(rejectRefund(r.id, staff.id, "또")).rejects.toMatchObject({ status: 409 });
    const again = await requestRefund(user.id, item.id, "다시 신청해요", now);
    expect(again.status).toBe("requested");
  });

  it("foreign item 404", async () => {
    const { now, item } = await boughtCourse(3);
    const other = await makeUser();
    await expect(previewRefund(other.id, item.id, now)).rejects.toMatchObject({ status: 404 });
    await expect(requestRefund(other.id, item.id, "남의 것", now)).rejects.toMatchObject({ status: 404 });
  });

  it("refunded item cannot be requested again", async () => {
    const { now, user, item } = await boughtCourse(3);
    const staff = await makeStaff("cs");
    const r = await requestRefund(user.id, item.id, "변심", now);
    await approveRefund(r.id, staff.id, {}, now);
    await expect(requestRefund(user.id, item.id, "또", now)).rejects.toMatchObject({ status: 409 });
  });
});

describe("API", () => {
  it("preview and request need the owner", async () => {
    const { user, item } = await boughtCourse(3);
    const cookies = await loginCookie(user.id);
    const p = await call(previewRoute, { cookies, url: `http://localhost/api/refunds/preview?item=${item.id}` });
    expect(p.status).toBe(200);
    expect(p.body.quote.refund).toBe(99_000);
    const other = await loginCookie((await makeUser()).id);
    expect((await call(previewRoute, { cookies: other, url: `http://localhost/api/refunds/preview?item=${item.id}` })).status).toBe(404);
    const r = await call(requestRoute, { cookies, body: { order_item_id: item.id, reason: "단순 변심이에요" } });
    expect(r.status).toBe(201);
    expect(r.body.refund.status).toBe("requested");
  });

  it("approve needs refunds permission", async () => {
    const { now, user, item } = await boughtCourse(3);
    const r = await requestRefund(user.id, item.id, "변심", now);
    const content = await makeStaff("content");
    const cs = await makeStaff("cs");
    const denied = await call(approveRoute, { cookies: { [STAFF_COOKIE]: await issueStaffSession(content.id) }, body: {}, params: { id: r.id } });
    expect(denied.status).toBe(403);
    const ok = await call(approveRoute, { cookies: { [STAFF_COOKIE]: await issueStaffSession(cs.id) }, body: {}, params: { id: r.id } });
    expect(ok.status).toBe(200);
    expect(ok.body.refund.status).toBe("done");
  });
});
