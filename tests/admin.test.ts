import { beforeEach, describe, expect, it } from "vitest";
import { POST as apiKeyIssueRoute } from "@/app/api/admin/api-keys/route";
import { POST as courseApproveRoute } from "@/app/api/admin/courses/[code]/approve/route";
import { POST as courseRejectRoute } from "@/app/api/admin/courses/[code]/reject/route";
import { POST as deviceRevokeRoute } from "@/app/api/admin/devices/[id]/revoke/route";
import { POST as inquiryAnswerRoute } from "@/app/api/admin/inquiries/[id]/answer/route";
import { GET as calculatorRoute } from "@/app/api/admin/refunds/[id]/calculator/route";
import { POST as refundApproveRoute } from "@/app/api/admin/refunds/[id]/approve/route";
import { POST as reviewHideRoute } from "@/app/api/admin/reviews/[id]/hide/route";
import { adminSubscriptions, approveCourse, dashboardCounts, refundCalculator, rejectCourse } from "@/server/admin";
import { authApiKey, issueApiKey, revokeApiKey } from "@/server/apikeys";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { STAFF_COOKIE, issueStaffSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { makeCourse, makeInstructor, makePaidOrder, makeStaff, makeSubscription, makeUser } from "./helpers/fixtures";

const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

const staffCookie = async (role: "admin" | "cs" | "content") => {
  const s = await makeStaff(role);
  return { staff: s, cookies: { [STAFF_COOKIE]: await issueStaffSession(s.id) } };
};

const bearer = (key: string) => new Request("http://localhost/api/v1/x", { headers: { authorization: `Bearer ${key}` } });

describe("강의 심사", () => {
  it("approve course publishes", async () => {
    const { course } = await makeCourse({ status: "in_review" });
    const { staff, cookies } = await staffCookie("content");
    const res = await call(courseApproveRoute, { method: "POST", cookies, params: { code: course.code } });
    expect(res.status).toBe(200);
    const after = await db.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(after.status).toBe("published");
    expect(after.published_at).not.toBeNull();
    expect(await db.auditLog.count({ where: { actor: `staff:${staff.id}`, action: "course.approve" } })).toBe(1);
    // 심사 중이 아닌 강의는 409
    await expect(approveCourse(staff.id, course.code)).rejects.toMatchObject({ status: 409 });
  });

  it("reject needs reason", async () => {
    const instructor = await makeInstructor();
    await db.instructorUser.create({ data: { email: "rejectme@studyon.test", password_hash: "scrypt$test", instructor_id: instructor.id } });
    const { course } = await makeCourse({ status: "in_review", instructorId: instructor.id });
    const { staff, cookies } = await staffCookie("content");
    const empty = await call(courseRejectRoute, { method: "POST", cookies, params: { code: course.code }, body: { reason: "  " } });
    expect(empty.status).toBe(400);
    await expect(rejectCourse(staff.id, course.code, "")).rejects.toMatchObject({ status: 400 });
    expect((await db.course.findUniqueOrThrow({ where: { id: course.id } })).status).toBe("in_review");

    const ok = await call(courseRejectRoute, { method: "POST", cookies, params: { code: course.code }, body: { reason: "3강 음성이 잘려요." } });
    expect(ok.status).toBe(200);
    const after = await db.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(after.status).toBe("rejected");
    expect(after.reject_reason).toBe("3강 음성이 잘려요.");
    const msg = await db.message.findFirst({ where: { kind: "course_rejected", to: "rejectme@studyon.test" } });
    expect(msg?.body).toContain("3강 음성이 잘려요.");
    expect(await db.auditLog.count({ where: { action: "course.reject" } })).toBe(1);
  });
});

describe("환불 계산기", () => {
  it("calculator side by side", async () => {
    // Task 6 "methods side by side": 99,000원, 10일 경과, 365일, 6000초 중 180초 → 진도 96,030 · 기간 96,288 · 적용 96,030
    const PAID_AT = new Date("2026-11-02T03:00:00Z");
    const now = new Date(PAID_AT.getTime() + 10 * DAY);
    const user = await makeUser();
    const { course, lectures } = await makeCourse({ price: 99_000, lectures: Array(10).fill(600), accessDays: 365 });
    const { item } = await makePaidOrder(user.id, course.id, 99_000, PAID_AT);
    await db.lectureProgress.create({ data: { user_id: user.id, lecture_id: lectures[0].id, course_id: course.id, watched_sec: 180 } });
    const refund = await db.refund.create({
      data: { user_id: user.id, order_item_id: item.id, reason: "시험", basis: {}, calc_amount: 96_030, amount: 96_030 },
    });
    const c = await refundCalculator(refund.id, now);
    expect(c.progress_based).toBe(96_030);
    expect(c.period_based).toBe(96_288);
    expect(c.applied).toBe(96_030);
    expect(c.basis_ko).toContain("결제 후 10일");

    const { cookies } = await staffCookie("cs");
    const res = await call(calculatorRoute, { cookies, params: { id: refund.id } });
    expect(res.status).toBe(200);
    expect(res.body.calculator).toHaveProperty("progress_based");
    expect(res.body.calculator).toHaveProperty("period_based");
  });
});

describe("권한표", () => {
  it("perm matrix via routes", async () => {
    const user = await makeUser();
    const { course } = await makeCourse({ status: "in_review" });
    const { item } = await makePaidOrder(user.id, course.id);
    const refund = await db.refund.create({ data: { user_id: user.id, order_item_id: item.id, reason: "시험", basis: {}, calc_amount: 1, amount: 1 } });

    const content = await staffCookie("content");
    const cs = await staffCookie("cs");
    const admin = await staffCookie("admin");

    expect((await call(refundApproveRoute, { method: "POST", cookies: content.cookies, params: { id: refund.id }, body: {} })).status).toBe(403);
    expect((await call(courseApproveRoute, { method: "POST", cookies: cs.cookies, params: { code: course.code } })).status).toBe(403);
    expect((await call(apiKeyIssueRoute, { method: "POST", cookies: cs.cookies, body: { name: "외부", scopes: ["read"] } })).status).toBe(403);
    expect((await call(apiKeyIssueRoute, { method: "POST", cookies: content.cookies, body: { name: "외부", scopes: ["read"] } })).status).toBe(403);
    expect((await call(apiKeyIssueRoute, { method: "POST", body: { name: "외부", scopes: ["read"] } })).status).toBe(401);

    const issued = await call(apiKeyIssueRoute, { method: "POST", cookies: admin.cookies, body: { name: "외부", scopes: ["read", "metrics"] } });
    expect(issued.status).toBe(201);
    expect(issued.body.key).toMatch(/^sok_/);
    expect(await db.auditLog.count({ where: { action: "apikey.issue" } })).toBe(1);
    // 원문은 저장하지 않는다
    expect(await db.apiKey.count({ where: { key_hash: issued.body.key } })).toBe(0);
  });
});

describe("대시보드", () => {
  it("dashboardCounts", async () => {
    const now = new Date("2026-11-18T03:00:00Z"); // KST 11월 18일 12:00
    const todayStart = new Date("2026-11-17T15:00:00Z"); // KST 11월 18일 00:00
    const justBefore = new Date(todayStart.getTime() - 60_000);
    const user = await makeUser();
    const { course } = await makeCourse({ price: 99_000 });

    // 오늘 주문 1건(99,000), 어제(KST) 주문 1건
    const today = await makePaidOrder(user.id, course.id, 99_000, new Date(todayStart.getTime() + 30 * 60_000));
    await db.payment.create({ data: { order_id: today.order.id, kind: "charge", method: "mock", amount: 99_000, status: "approved", approved_at: today.order.paid_at } });
    const { course: c2 } = await makeCourse({ price: 50_000 });
    const yday = await makePaidOrder(user.id, c2.id, 50_000, justBefore);
    await db.payment.create({ data: { order_id: yday.order.id, kind: "charge", method: "mock", amount: 50_000, status: "approved", approved_at: justBefore } });
    // 오늘 환불 결제 10,000
    await db.payment.create({ data: { order_id: yday.order.id, kind: "refund", method: "mock", amount: 10_000, status: "approved", approved_at: now } });

    // 새 구독 1 (첫 청구가 오늘 결제), 갱신 1 (예전 청구 + 오늘 갱신)
    const subNew = await makeSubscription((await makeUser()).id, now);
    const inv1 = await db.subscriptionInvoice.create({ data: { subscription_id: subNew.id, period_start: now, period_end: new Date(now.getTime() + 30 * DAY), amount: 29_000, status: "paid", paid_at: now } });
    await db.payment.create({ data: { invoice_id: inv1.id, kind: "charge", method: "mock", amount: 29_000, status: "approved", approved_at: now } });
    const subOld = await makeSubscription((await makeUser()).id, new Date(now.getTime() - 30 * DAY));
    await db.subscriptionInvoice.create({ data: { subscription_id: subOld.id, period_start: new Date(now.getTime() - 30 * DAY), period_end: now, amount: 29_000, status: "paid", paid_at: new Date(now.getTime() - 30 * DAY) } });
    const inv2 = await db.subscriptionInvoice.create({ data: { subscription_id: subOld.id, period_start: now, period_end: new Date(now.getTime() + 30 * DAY), amount: 29_000, status: "paid", paid_at: now } });
    await db.payment.create({ data: { invoice_id: inv2.id, kind: "charge", method: "mock", amount: 29_000, status: "approved", approved_at: now } });
    // 결제 전 가입(구독 행만 있음)은 새 구독이 아니다
    await makeSubscription((await makeUser()).id, now);

    // 오늘 해지 1, 어제 해지 1
    const cancelled = await makeSubscription((await makeUser()).id, new Date(now.getTime() - 40 * DAY));
    await db.subscription.update({ where: { id: cancelled.id }, data: { status: "cancelled", cancelled_at: now } });
    const cancelledOld = await makeSubscription((await makeUser()).id, new Date(now.getTime() - 40 * DAY));
    await db.subscription.update({ where: { id: cancelledOld.id }, data: { status: "cancelled", cancelled_at: justBefore } });

    // 결제 실패: 오늘 1, 어제 1
    await db.payment.create({ data: { invoice_id: inv2.id, kind: "charge", method: "mock", amount: 29_000, status: "failed", created_at: now } });
    await db.payment.create({ data: { invoice_id: inv2.id, kind: "charge", method: "mock", amount: 29_000, status: "failed", created_at: justBefore } });

    // 환불 요청 1(열림) + 처리 기한(5일) 넘긴 승인 1 + 오늘 승인 1 + 거절 1
    const mk = async (status: string, approved_at: Date | null) => {
      const { course: c } = await makeCourse();
      const { item } = await makePaidOrder(user.id, c.id, 99_000, new Date(now.getTime() - 20 * DAY));
      return db.refund.create({ data: { user_id: user.id, order_item_id: item.id, reason: "시험", basis: {}, calc_amount: 1, amount: 1, status, approved_at } });
    };
    await mk("requested", null);
    await mk("approved", new Date(now.getTime() - 6 * DAY));
    await mk("approved", now);
    await mk("rejected", null);

    // 미답변 질문 1 (답한 것 1), 열린 문의 1 (답한 것 1)
    const { course: qc, lectures } = await makeCourse();
    await db.question.create({ data: { lecture_id: lectures[0].id, course_id: qc.id, user_id: user.id, title: "질문", body: "본문" } });
    await db.question.create({ data: { lecture_id: lectures[0].id, course_id: qc.id, user_id: user.id, title: "답한 질문", body: "본문", answered_at: now } });
    await db.inquiry.create({ data: { user_id: user.id, category: "etc", title: "문의", body: "본문" } });
    await db.inquiry.create({ data: { user_id: user.id, category: "etc", title: "답한 문의", body: "본문", status: "answered", answer: "답", answered_at: now } });

    const c = await dashboardCounts(now);
    expect(c).toEqual({
      today_sales: 99_000 + 29_000 + 29_000 - 10_000,
      today_orders: 1,
      refund_requests: 1,
      new_subscriptions: 1,
      cancellations: 1,
      payment_failures: 1,
      unanswered_questions: 1,
      open_inquiries: 1,
      overdue_refunds: 1,
    });
  });
});

describe("API 키", () => {
  it("api key metrics scope", async () => {
    const admin = await makeStaff("admin");
    const read = await issueApiKey("읽기 전용", ["read"], admin.id);
    expect(read.key).toMatch(/^sok_/);
    await expect(authApiKey(bearer(read.key), "metrics")).rejects.toMatchObject({ status: 403 });
    await expect(authApiKey(bearer(read.key), "write")).rejects.toMatchObject({ status: 403 });
    expect((await authApiKey(bearer(read.key), "read")).id).toBe(read.id);

    const metrics = await issueApiKey("지표 수집", ["metrics"], admin.id);
    expect((await authApiKey(bearer(metrics.key), "metrics")).id).toBe(metrics.id);
    await expect(authApiKey(bearer(metrics.key), "read")).rejects.toMatchObject({ status: 403 });

    await expect(authApiKey(bearer("sok_wrong"), "read")).rejects.toMatchObject({ status: 401 });
    await expect(authApiKey(new Request("http://localhost/x"), "read")).rejects.toMatchObject({ status: 401 });
    await revokeApiKey(read.id);
    await expect(authApiKey(bearer(read.key), "read")).rejects.toMatchObject({ status: 401 });
    await expect(issueApiKey("빈 범위", [], admin.id)).rejects.toMatchObject({ status: 400 });
  });
});

describe("수강생·소통 관리", () => {
  it("revoke device from admin", async () => {
    const user = await makeUser();
    const device = await db.device.create({ data: { user_id: user.id, device_key: "admin-revoke-01", name: "시험 기기" } });
    const content = await staffCookie("content");
    expect((await call(deviceRevokeRoute, { method: "POST", cookies: content.cookies, params: { id: device.id } })).status).toBe(403);
    const { staff, cookies } = await staffCookie("cs");
    const res = await call(deviceRevokeRoute, { method: "POST", cookies, params: { id: device.id } });
    expect(res.status).toBe(200);
    expect((await db.device.findUniqueOrThrow({ where: { id: device.id } })).revoked_at).not.toBeNull();
    expect(await db.auditLog.count({ where: { actor: `staff:${staff.id}`, action: "device.revoke" } })).toBe(1);
  });

  it("hide review and answer inquiry routes", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    const review = await db.review.create({ data: { user_id: user.id, course_id: course.id, rating: 1, body: "광고 글" } });
    const inquiry = await db.inquiry.create({ data: { user_id: user.id, category: "payment", title: "결제 문의", body: "본문" } });
    const content = await staffCookie("content");
    expect((await call(reviewHideRoute, { method: "POST", cookies: content.cookies, params: { id: review.id }, body: { hidden: true } })).status).toBe(403);
    const { cookies } = await staffCookie("cs");
    expect((await call(reviewHideRoute, { method: "POST", cookies, params: { id: review.id }, body: { hidden: true } })).status).toBe(200);
    expect((await db.review.findUniqueOrThrow({ where: { id: review.id } })).hidden).toBe(true);
    expect(await db.auditLog.count({ where: { action: "review.hide" } })).toBe(1);

    expect((await call(inquiryAnswerRoute, { method: "POST", cookies, params: { id: inquiry.id }, body: { answer: "" } })).status).toBe(400);
    expect((await call(inquiryAnswerRoute, { method: "POST", cookies, params: { id: inquiry.id }, body: { answer: "확인해 드렸어요." } })).status).toBe(200);
    expect((await db.inquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("answered");
  });

  it("admin subscription list hides never-paid signups", async () => {
    const now = new Date();
    const paid = await makeSubscription((await makeUser()).id, now);
    await db.subscriptionInvoice.create({ data: { subscription_id: paid.id, period_start: now, period_end: new Date(now.getTime() + 30 * DAY), amount: 29_000, status: "paid", paid_at: now } });
    const unpaid = await makeSubscription((await makeUser()).id, now);
    await db.subscription.update({ where: { id: unpaid.id }, data: { status: "expired" } });
    await db.subscriptionInvoice.create({ data: { subscription_id: unpaid.id, period_start: now, period_end: new Date(now.getTime() + 30 * DAY), amount: 29_000 } });
    const list = await adminSubscriptions({});
    expect(list.items.map((s) => s.id)).toEqual([paid.id]);
    const withUnpaid = await adminSubscriptions({ includeUnpaid: true });
    expect(withUnpaid.items.map((s) => s.id).sort()).toEqual([paid.id, unpaid.id].sort());
  });
});
