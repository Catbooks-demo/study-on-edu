import { beforeEach, describe, expect, it } from "vitest";
import { POST as subscribeRoute } from "@/app/api/subscriptions/route";
import { POST as pauseRoute } from "@/app/api/subscriptions/[id]/pause/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { db } from "@/server/db";
import { resetEnvCache } from "@/server/env";
import { runJobsOnce } from "@/server/jobs";
import { subscriptionWatchedSec } from "@/server/learning-usage";
import { mockPayInvoice } from "@/server/payments";
import { approveRefund, requestSubscriptionRefund } from "@/server/refunds";
import {
  cancelAtPeriodEnd,
  changeCard,
  courseAccess,
  pause,
  renewSubscriptions,
  resume,
  retryInvoiceNow,
  subscribe,
  undoCancel,
} from "@/server/subscriptions";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { loginCookie, makeCourse, makeStaff, makeUser } from "./helpers/fixtures";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** 2026-11-01 12:00 KST. 월 구독이면 기간은 2026-12-01 12:00 KST까지(30일). */
const T0 = new Date("2026-11-01T03:00:00Z");
const END1 = new Date("2026-12-01T03:00:00Z");
const EXPIRED_TEXT = "결제가 세 번 더 실패해서 구독이 끝났어요. 진도는 남아 있어 다시 구독하면 이어서 볼 수 있어요.";

const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

function noToss() {
  delete process.env.TOSS_CLIENT_KEY;
  delete process.env.TOSS_SECRET_KEY;
  resetEnvCache();
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  noToss();
  await db.plan.create({ data: { code: "monthly", name: "월 구독", interval: "month", price: 29_000, refund_base_hours: 20 } });
  await db.plan.create({ data: { code: "yearly", name: "연 구독", interval: "year", price: 290_000, refund_base_hours: 240 } });
});

/** T0에 월 구독 → 모의 결제까지. */
async function subscribed(now = T0) {
  const user = await makeUser();
  const r = await subscribe(user.id, "monthly", { card_last4: "1234" }, now);
  await mockPayInvoice(r.invoice.id, now);
  const sub = await db.subscription.findUniqueOrThrow({ where: { id: r.subscription.id } });
  return { user, sub, invoice: r.invoice };
}

const getSub = (id: string) => db.subscription.findUniqueOrThrow({ where: { id } });
const enrollmentOf = (userId: string, courseId: string) =>
  db.enrollment.findUniqueOrThrow({ where: { user_id_course_id: { user_id: userId, course_id: courseId } } });

describe("구독 가입", () => {
  it("subscribe then mock pay → active, period +1 month", async () => {
    const user = await makeUser();
    const r = await subscribe(user.id, "monthly", { card_last4: "1234" }, T0);
    expect(r.invoice.status).toBe("pending");
    expect(r.invoice.amount).toBe(29_000);
    expect(r.pay.amount).toBe(29_000);
    expect(r.pay.orderId).toBeTruthy();
    expect((await getSub(r.subscription.id)).status).not.toBe("active");

    const paid = await mockPayInvoice(r.invoice.id, T0);
    expect(paid.invoice?.status).toBe("paid");
    const sub = await getSub(r.subscription.id);
    expect(sub.status).toBe("active");
    expect(sub.current_period_start.toISOString()).toBe(T0.toISOString());
    expect(sub.current_period_end.toISOString()).toBe(END1.toISOString());
    expect(sub.card_last4).toBe("1234");

    await expect(subscribe(user.id, "yearly", { card_last4: "1234" }, T0)).rejects.toMatchObject({
      status: 409,
      code: "ALREADY_SUBSCRIBED",
      message: "이미 구독 중이에요.",
    });
  });

  it("yearly plan period is 12 months", async () => {
    const user = await makeUser();
    const r = await subscribe(user.id, "yearly", { card_last4: "1234" }, T0);
    expect(r.invoice.amount).toBe(290_000);
    await mockPayInvoice(r.invoice.id, T0);
    expect((await getSub(r.subscription.id)).current_period_end.toISOString()).toBe("2027-11-01T03:00:00.000Z");
  });

  it("unpaid subscribe can be retried without a second subscription", async () => {
    const user = await makeUser();
    const a = await subscribe(user.id, "monthly", { card_last4: "1234" }, T0);
    const b = await subscribe(user.id, "yearly", { card_last4: "5678" }, at(T0, HOUR));
    expect(b.subscription.id).toBe(a.subscription.id);
    expect(await db.subscription.count({ where: { user_id: user.id } })).toBe(1);
    expect(b.invoice.amount).toBe(290_000);
    await mockPayInvoice(b.invoice.id, at(T0, HOUR));
    const sub = await getSub(b.subscription.id);
    expect(sub.status).toBe("active");
    expect(sub.card_last4).toBe("5678");
    expect(await db.subscriptionInvoice.count({ where: { subscription_id: sub.id } })).toBe(1);
  });

  it("POST /api/subscriptions pays with mock when toss is off", async () => {
    const user = await makeUser();
    const res = await call(subscribeRoute, { body: { plan_code: "monthly", card_last4: "1234" }, cookies: await loginCookie(user.id) });
    expect(res.status).toBe(201);
    expect(res.body.subscription.status).toBe("active");
    expect(res.body.invoice.status).toBe("paid");
    const bad = await call(subscribeRoute, { body: { plan_code: "monthly", card_last4: "12" }, cookies: await loginCookie(user.id) });
    expect(bad.status).toBe(400);
  });

  it("subscription grants plan courses lazily", async () => {
    const { user, sub } = await subscribed();
    const { course: inSub } = await makeCourse({ inSubscription: true });
    const { course: notSub } = await makeCourse({ inSubscription: false });
    expect(await db.enrollment.count()).toBe(0);

    const e = await courseAccess(user.id, inSub.id, at(T0, DAY));
    expect(e.source).toBe("subscription");
    expect(e.subscription_id).toBe(sub.id);
    expect(e.expires_at).toBeNull();
    expect((await enrollmentOf(user.id, inSub.id)).status).toBe("active");
    // 두 번 불러도 수강권은 하나
    await courseAccess(user.id, inSub.id, at(T0, DAY));
    expect(await db.enrollment.count({ where: { user_id: user.id } })).toBe(1);

    await expect(courseAccess(user.id, notSub.id, at(T0, DAY))).rejects.toMatchObject({ status: 403, code: "NO_ACCESS" });
    const stranger = await makeUser();
    await expect(courseAccess(stranger.id, inSub.id, at(T0, DAY))).rejects.toMatchObject({ status: 403, code: "NO_ACCESS" });
  });
});

describe("갱신 작업", () => {
  it("renewal success moves period", async () => {
    const { sub } = await subscribed();
    const early = await runJobsOnce(at(END1, -24 * HOUR - 60_000));
    expect(early.renewSubscriptions).toBe(0);

    const r = await runJobsOnce(at(END1, -24 * HOUR));
    expect(r.renewSubscriptions).toBe(1);
    const s = await getSub(sub.id);
    expect(s.status).toBe("active");
    expect(s.current_period_start.toISOString()).toBe(END1.toISOString());
    expect(s.current_period_end.toISOString()).toBe("2027-01-01T03:00:00.000Z");
    const inv = await db.subscriptionInvoice.findUniqueOrThrow({
      where: { subscription_id_period_start: { subscription_id: sub.id, period_start: END1 } },
    });
    expect(inv.status).toBe("paid");
    expect(inv.amount).toBe(29_000);
    expect(await db.message.count({ where: { user_id: sub.user_id, kind: "subscription_renewed" } })).toBe(1);
  });

  it("renewal twice → one invoice", async () => {
    const { sub } = await subscribed();
    const now = at(END1, -23 * HOUR);
    await runJobsOnce(now);
    await runJobsOnce(now);
    await Promise.all([runJobsOnce(now), runJobsOnce(now)]);
    await Promise.all([renewSubscriptions(now), renewSubscriptions(now)]);

    const invs = await db.subscriptionInvoice.findMany({ where: { subscription_id: sub.id, period_start: END1 } });
    expect(invs).toHaveLength(1);
    expect(await db.payment.count({ where: { invoice_id: invs[0].id, kind: "charge" } })).toBe(1);
    expect(await db.subscriptionInvoice.count({ where: { subscription_id: sub.id } })).toBe(2);
  });

  it("renewal twice at the same time, without the job lock", async () => {
    const { sub } = await subscribed();
    const now = at(END1, -23 * HOUR);
    const counts = await Promise.all([renewSubscriptions(now), renewSubscriptions(now), renewSubscriptions(now)]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    const invs = await db.subscriptionInvoice.findMany({ where: { subscription_id: sub.id, period_start: END1 } });
    expect(invs).toHaveLength(1);
    expect(await db.payment.count({ where: { invoice_id: invs[0].id, kind: "charge" } })).toBe(1);
  });

  it("cancel at period end → no invoice, cancelled at end, enrollments expired, progress kept", async () => {
    const { user, sub } = await subscribed();
    const { course, lectures } = await makeCourse({ inSubscription: true });
    await courseAccess(user.id, course.id, at(T0, DAY));
    await db.lectureProgress.create({ data: { user_id: user.id, lecture_id: lectures[0].id, course_id: course.id, watched_sec: 120 } });

    await cancelAtPeriodEnd(user.id, sub.id);
    await undoCancel(user.id, sub.id);
    expect((await getSub(sub.id)).cancel_at_period_end).toBe(false);
    await cancelAtPeriodEnd(user.id, sub.id);
    expect((await getSub(sub.id)).cancel_at_period_end).toBe(true);

    const before = await runJobsOnce(at(END1, -23 * HOUR));
    expect(before.renewSubscriptions).toBe(0);
    expect(await db.subscriptionInvoice.count({ where: { subscription_id: sub.id } })).toBe(1);
    expect((await getSub(sub.id)).status).toBe("active");

    const end = await runJobsOnce(at(END1, 60_000));
    expect(end.endSubscriptions).toBe(1);
    const s = await getSub(sub.id);
    expect(s.status).toBe("cancelled");
    expect(s.cancelled_at).not.toBeNull();
    expect(await db.subscriptionInvoice.count({ where: { subscription_id: sub.id } })).toBe(1);
    expect((await enrollmentOf(user.id, course.id)).status).toBe("expired");
    expect(await db.lectureProgress.count({ where: { user_id: user.id, course_id: course.id, watched_sec: 120 } })).toBe(1);
    await expect(courseAccess(user.id, course.id, at(END1, HOUR))).rejects.toMatchObject({ status: 403 });

    const again = await runJobsOnce(at(END1, 2 * 60_000));
    expect(again.endSubscriptions).toBe(0);
    await expect(undoCancel(user.id, sub.id)).rejects.toMatchObject({ status: 409 });
  });

  it("card 4000 → past_due → retries at +1,+3,+5 → expired", async () => {
    const { user, sub } = await subscribed();
    const { course } = await makeCourse({ inSubscription: true });
    await courseAccess(user.id, course.id, at(T0, DAY));
    await changeCard(user.id, sub.id, "4000", at(T0, DAY));
    const first = at(END1, -24 * HOUR);

    await runJobsOnce(first);
    let s = await getSub(sub.id);
    expect(s.status).toBe("past_due");
    expect(s.failure_count).toBe(1);
    expect(s.first_failed_at?.toISOString()).toBe(first.toISOString());
    expect(s.next_retry_at?.toISOString()).toBe(at(first, DAY).toISOString());
    expect(await db.message.count({ where: { user_id: user.id, kind: "subscription_payment_failed" } })).toBe(1);

    // 재시도 시각 전에는 그대로
    const notYet = await runJobsOnce(at(first, DAY - 60_000));
    expect(notYet.retryFailedInvoices).toBe(0);
    expect((await getSub(sub.id)).failure_count).toBe(1);

    await runJobsOnce(at(first, DAY));
    s = await getSub(sub.id);
    expect([s.status, s.failure_count, s.next_retry_at?.toISOString()]).toEqual(["past_due", 2, at(first, 3 * DAY).toISOString()]);

    await runJobsOnce(at(first, 3 * DAY));
    s = await getSub(sub.id);
    expect([s.status, s.failure_count, s.next_retry_at?.toISOString()]).toEqual(["past_due", 3, at(first, 5 * DAY).toISOString()]);

    await runJobsOnce(at(first, 5 * DAY));
    s = await getSub(sub.id);
    expect(s.status).toBe("expired");
    expect(s.failure_count).toBe(4);
    expect(s.next_retry_at).toBeNull();
    expect((await enrollmentOf(user.id, course.id)).status).toBe("expired");
    const inv = await db.subscriptionInvoice.findUniqueOrThrow({
      where: { subscription_id_period_start: { subscription_id: sub.id, period_start: END1 } },
    });
    expect(inv.status).toBe("failed");
    expect(await db.payment.count({ where: { invoice_id: inv.id, kind: "charge", status: "failed" } })).toBe(4);

    await runJobsOnce(at(first, 6 * DAY));
    await runJobsOnce(at(first, 9 * DAY));
    const msgs = await db.message.findMany({ where: { user_id: user.id, kind: "subscription_expired" } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toContain(EXPIRED_TEXT);
    expect((await getSub(sub.id)).failure_count).toBe(4);
  });

  it("past_due keeps access", async () => {
    const { user, sub } = await subscribed();
    const { course } = await makeCourse({ inSubscription: true });
    await changeCard(user.id, sub.id, "4000", at(T0, DAY));
    await runJobsOnce(at(END1, -24 * HOUR));
    expect((await getSub(sub.id)).status).toBe("past_due");
    // 기간이 끝난 뒤에도 past_due 동안은 들을 수 있다 (처음 여는 강의도)
    const e = await courseAccess(user.id, course.id, at(END1, 2 * HOUR));
    expect(e.source).toBe("subscription");
  });

  it("retry success keeps cycle", async () => {
    const { user, sub } = await subscribed();
    await changeCard(user.id, sub.id, "4000", at(T0, DAY));
    const first = at(END1, -24 * HOUR);
    await runJobsOnce(first);
    expect((await getSub(sub.id)).status).toBe("past_due");

    // 카드를 바꾸면 바로 다시 결제한다. 새 기간은 원래 기간 끝에서 시작한다.
    const fixedAt = at(END1, 30 * HOUR);
    await changeCard(user.id, sub.id, "1234", fixedAt);
    const s = await getSub(sub.id);
    expect(s.status).toBe("active");
    expect(s.current_period_start.toISOString()).toBe(END1.toISOString());
    expect(s.current_period_end.toISOString()).toBe("2027-01-01T03:00:00.000Z");
    expect(s.failure_count).toBe(0);
    expect(s.next_retry_at).toBeNull();
    expect(await db.subscriptionInvoice.count({ where: { subscription_id: sub.id } })).toBe(2);

    // 다음 갱신은 새 기간 끝 하루 전에
    const r = await runJobsOnce(at(new Date("2027-01-01T03:00:00Z"), -24 * HOUR));
    expect(r.renewSubscriptions).toBe(1);
  });

  it("retry by job succeeds after the card is fixed", async () => {
    const { user, sub } = await subscribed();
    await changeCard(user.id, sub.id, "4000", at(T0, DAY));
    const first = at(END1, -24 * HOUR);
    await runJobsOnce(first);
    await db.subscription.update({ where: { id: sub.id }, data: { card_last4: "1234" } });
    const r = await runJobsOnce(at(first, DAY));
    expect(r.retryFailedInvoices).toBe(1);
    const s = await getSub(sub.id);
    expect(s.status).toBe("active");
    expect(s.current_period_start.toISOString()).toBe(END1.toISOString());
  });

  it("staff retry now only when past_due, follows the failure rule", async () => {
    const { user, sub } = await subscribed();
    const staff = await makeStaff("cs");
    await expect(retryInvoiceNow(`staff:${staff.id}`, sub.id, at(T0, DAY))).rejects.toMatchObject({ status: 409 });
    await changeCard(user.id, sub.id, "4000", at(T0, DAY));
    const first = at(END1, -24 * HOUR);
    await runJobsOnce(first);
    await retryInvoiceNow(`staff:${staff.id}`, sub.id, at(first, HOUR));
    const s = await getSub(sub.id);
    expect(s.status).toBe("past_due");
    expect(s.failure_count).toBe(2);
    expect(s.next_retry_at?.toISOString()).toBe(at(first, 3 * DAY).toISOString());
  });
});

describe("일시정지", () => {
  it("pause extends period and blocks playback", async () => {
    const { user, sub } = await subscribed();
    const { course } = await makeCourse({ inSubscription: true });
    await courseAccess(user.id, course.id, at(T0, DAY));

    const p0 = at(T0, 5 * DAY);
    await pause(user.id, sub.id, 10, p0);
    let s = await getSub(sub.id);
    expect(s.status).toBe("paused");
    expect(s.paused_until?.toISOString()).toBe(at(p0, 10 * DAY).toISOString());
    expect(s.current_period_end.toISOString()).toBe(at(END1, 10 * DAY).toISOString());
    await expect(courseAccess(user.id, course.id, at(p0, DAY))).rejects.toMatchObject({ status: 403 });

    // 3일 만에 풀면 남은 7일만큼 당긴다
    await resume(user.id, sub.id, at(p0, 3 * DAY));
    s = await getSub(sub.id);
    expect(s.status).toBe("active");
    expect(s.paused_until).toBeNull();
    expect(s.current_period_end.toISOString()).toBe(at(END1, 3 * DAY).toISOString());
    expect((await courseAccess(user.id, course.id, at(p0, 3 * DAY + HOUR))).status).toBe("active");
  });

  it("no renewal while paused", async () => {
    const { user, sub } = await subscribed();
    // 갱신 작업이 아직 돌지 않은 채 기간 끝 2시간 전에 하루 멈춘다 → 기간 끝은 22시간 뒤, 정지는 그 뒤에 풀린다
    const p0 = at(END1, -2 * HOUR);
    await pause(user.id, sub.id, 1, p0);
    const r = await runJobsOnce(at(p0, DAY - 60_000));
    expect(r.renewSubscriptions).toBe(0);
    expect(r.resumePaused).toBe(0);
    expect((await getSub(sub.id)).status).toBe("paused");
    expect(await db.subscriptionInvoice.count({ where: { subscription_id: sub.id } })).toBe(1);
    // 풀리면 같은 작업 차례에서 바로 갱신한다
    const after = await runJobsOnce(at(p0, DAY));
    expect(after.resumePaused).toBe(1);
    expect(after.renewSubscriptions).toBe(1);
    expect(await db.subscriptionInvoice.count({ where: { subscription_id: sub.id } })).toBe(2);
  });

  it("paused subscription resumes by job when the pause ends", async () => {
    const { user, sub } = await subscribed();
    const p0 = at(T0, 2 * DAY);
    await pause(user.id, sub.id, 5, p0);
    const before = await runJobsOnce(at(p0, 5 * DAY - 60_000));
    expect(before.resumePaused).toBe(0);
    const r = await runJobsOnce(at(p0, 5 * DAY));
    expect(r.resumePaused).toBe(1);
    const s = await getSub(sub.id);
    expect(s.status).toBe("active");
    expect(s.current_period_end.toISOString()).toBe(at(END1, 5 * DAY).toISOString());
    void user;
  });

  it("third pause in a year 400", async () => {
    const { user, sub } = await subscribed();
    const cookies = await loginCookie(user.id);
    await expect(pause(user.id, sub.id, 31, at(T0, DAY))).rejects.toMatchObject({
      status: 400,
      message: "일시정지는 1~30일 사이로 정해 주세요.",
    });
    await pause(user.id, sub.id, 2, at(T0, DAY));
    await expect(pause(user.id, sub.id, 2, at(T0, DAY + HOUR))).rejects.toMatchObject({ status: 409 });
    await resume(user.id, sub.id, at(T0, 2 * DAY));
    await pause(user.id, sub.id, 2, at(T0, 3 * DAY));
    await resume(user.id, sub.id, at(T0, 4 * DAY));

    const res = await call(pauseRoute, { body: { days: 3 }, cookies, params: { id: sub.id } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("일시정지는 1년에 2번까지 할 수 있어요.");
    expect((await getSub(sub.id)).status).toBe("active");
  });

  it("someone else's subscription is 404", async () => {
    const { sub } = await subscribed();
    const other = await makeUser();
    await expect(pause(other.id, sub.id, 3, at(T0, DAY))).rejects.toMatchObject({ status: 404 });
    await expect(cancelAtPeriodEnd(other.id, sub.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("구독 환불", () => {
  it("refund within 7 days no watch → full, subscription cancelled", async () => {
    const { user, sub, invoice } = await subscribed();
    const { course } = await makeCourse({ inSubscription: true });
    await courseAccess(user.id, course.id, at(T0, DAY));
    const staff = await makeStaff("cs");
    const now = at(T0, 3 * DAY);

    const r = await requestSubscriptionRefund(user.id, sub.id, "생각보다 안 맞아요", now);
    expect(r.status).toBe("requested");
    expect(r.invoice_id).toBe(invoice.id);
    expect(r.amount).toBe(29_000);
    expect((r.basis as { kind: string }).kind).toBe("full");
    await expect(requestSubscriptionRefund(user.id, sub.id, "또", now)).rejects.toMatchObject({ status: 409, code: "REFUND_OPEN" });

    const done = await approveRefund(r.id, staff.id, {}, now);
    expect(done.status).toBe("done");
    const refunded = await db.payment.findMany({ where: { invoice_id: invoice.id, kind: "refund", status: "approved" } });
    expect(refunded.reduce((a, p) => a + p.amount, 0)).toBe(29_000);
    expect((await db.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("refunded");
    const s = await getSub(sub.id);
    expect(s.status).toBe("cancelled");
    expect((await enrollmentOf(user.id, course.id)).status).toBe("expired");
    expect(await db.message.count({ where: { user_id: user.id, kind: "refund_done" } })).toBe(1);

    // 끝난 구독은 다시 환불 신청할 수 없고, 새로 구독할 수 있다
    await expect(requestSubscriptionRefund(user.id, sub.id, "또", now)).rejects.toMatchObject({ status: 409 });
    const again = await subscribe(user.id, "monthly", { card_last4: "1234" }, at(now, HOUR));
    expect(again.subscription.id).not.toBe(sub.id);
  });

  it("refund prorated uses period watch", async () => {
    const { user, sub, invoice } = await subscribed();
    const { course, lectures } = await makeCourse({ inSubscription: true, lectures: [3600, 3600, 3600, 3600] });
    const device = await db.device.create({ data: { user_id: user.id, device_key: "dev-a", name: "Windows · Chrome" } });
    const ev = (created_at: Date, added_sec: number, source = "subscription", i = 0) =>
      db.watchEvent.create({
        data: {
          user_id: user.id, lecture_id: lectures[i].id, course_id: course.id, device_id: device.id,
          from_sec: 0, to_sec: added_sec, rate: 1, added_sec, source, created_at,
        },
      });
    // 이 기간 구독 시청 3시간
    await ev(at(T0, DAY), 3600, "subscription", 0);
    await ev(at(T0, 2 * DAY), 3600, "subscription", 1);
    await ev(at(T0, 4 * DAY), 1800, "subscription", 2);
    await ev(at(T0, 4 * DAY + HOUR), 1800, "subscription", 2);
    await ev(at(T0, 5 * DAY), 0, "subscription", 2); // 다시 본 구간 (새로 더한 초 0)
    // 세지 않는 것: 기간 전, 구독 아닌 수강권, 남의 시청
    await ev(at(T0, -DAY), 3600, "subscription", 3);
    await ev(at(T0, 3 * DAY), 3600, "order", 3);
    const other = await makeUser();
    const otherDevice = await db.device.create({ data: { user_id: other.id, device_key: "dev-b", name: "Mac · Safari" } });
    await db.watchEvent.create({
      data: {
        user_id: other.id, lecture_id: lectures[3].id, course_id: course.id, device_id: otherDevice.id,
        from_sec: 0, to_sec: 3600, rate: 1, added_sec: 3600, source: "subscription", created_at: at(T0, DAY),
      },
    });

    expect(await subscriptionWatchedSec(sub.id, invoice.period_start, invoice.period_end)).toBe(3 * 3600);

    const now = at(T0, 10 * DAY);
    const r = await requestSubscriptionRefund(user.id, sub.id, "시간이 없어요", now);
    expect((r.basis as { kind: string }).kind).toBe("prorated");
    expect(r.calc_amount).toBe(19_334);
    expect(r.amount).toBe(19_334);

    const staff = await makeStaff("cs");
    const done = await approveRefund(r.id, staff.id, {}, now);
    expect(done.status).toBe("done");
    expect(done.amount).toBe(19_334);
    expect((await getSub(sub.id)).status).toBe("cancelled");
  });
});
