import { randomUUID } from "node:crypto";
import type { Enrollment, Plan, Prisma, Subscription, SubscriptionInvoice, User } from "@prisma/client";
import { type Interval, afterFailure, canPause, periodEnd, renewalDue, resumeEarly } from "@/rules/billing";
import { audit } from "./audit";
import { db } from "./db";
import { activeEnrollment } from "./enrollments";
import { tossEnabled } from "./env";
import { onSubscriptionStatus } from "./hooks";
import { HttpError } from "./http";
import { recordMessage, won } from "./messages";
import { chargeMockInvoice, prepareInvoicePayment } from "./payments";
import type { Tx } from "./tx";

/**
 * 구독 서비스 (spec "규칙 › 구독 자동 결제"·계획 "이 계획이 정한 것").
 * 상태: active · past_due · paused · cancelled · expired. 결제 전 가입은 아직 쓸 수 없으므로 expired로 두고,
 * 첫 청구가 결제되면(onInvoicePaid) active가 된다.
 *
 * 돈이 오가는 흐름(갱신·재시도)과 상태를 바꾸는 흐름은 구독마다 advisory lock(`sub:<id>`)을 잡고 하나씩 돈다.
 * 청구는 (subscription_id, period_start) unique라 기간마다 하나뿐이다: 갱신은 INSERT … ON CONFLICT DO NOTHING으로
 * 청구를 만들고, 만든 쪽만 결제한다(작업이 두 번 돌아도 청구·결제는 한 번).
 */

export const ALIVE = ["active", "past_due", "paused"];
const PLAYABLE = ["active", "past_due"];
const DAY_MS = 86_400_000;

export const EXPIRED_TEXT = "결제가 세 번 더 실패해서 구독이 끝났어요. 진도는 남아 있어 다시 구독하면 이어서 볼 수 있어요.";

type SubFull = Subscription & { user: User; plan: Plan };
type PauseRec = { start: string; days: number };

const NOT_FOUND = () => new HttpError(404, "NOT_FOUND", "구독을 찾지 못했어요.");
const kstDay = (d: Date) => d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

export function pausesOf(s: Pick<Subscription, "pauses">): { start: Date; days: number }[] {
  const raw = Array.isArray(s.pauses) ? (s.pauses as unknown as PauseRec[]) : [];
  return raw.filter((p) => p && typeof p.start === "string").map((p) => ({ start: new Date(p.start), days: Number(p.days) }));
}

function assertCard(last4: string): void {
  if (!/^\d{4}$/.test(last4)) throw new HttpError(400, "BAD_CARD", "카드 끝 4자리를 숫자 4개로 적어 주세요.");
}

/** 구독 하나에 대한 작업을 하나씩 (advisory lock). fn 안의 tx는 잠금을 잡은 연결이다. */
async function withSubLock<T>(subId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sub:${subId}`}))`;
      return fn(tx);
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}

async function loadSub(tx: Tx, subId: string): Promise<SubFull | null> {
  return tx.subscription.findUnique({ where: { id: subId }, include: { user: true, plan: true } });
}

async function ownSub(tx: Tx, userId: string, subId: string): Promise<SubFull> {
  const s = await loadSub(tx, subId);
  if (!s || s.user_id !== userId) throw NOT_FOUND();
  return s;
}

/** 구독으로 얻은 수강권을 만료로 (진도는 그대로 남는다). */
export async function expireSubscriptionEnrollments(tx: Tx, subId: string): Promise<number> {
  const r = await tx.enrollment.updateMany({
    where: { subscription_id: subId, source: "subscription", status: "active" },
    data: { status: "expired" },
  });
  return r.count;
}

/** 구독을 끝낸다 (cancelled·expired). 남은 대기 청구는 failed, 구독 수강권은 만료. */
export async function endSubscription(tx: Tx, sub: Subscription, to: "cancelled" | "expired", now: Date, extra: Prisma.SubscriptionUpdateInput = {}) {
  await tx.subscription.update({
    where: { id: sub.id },
    data: {
      status: to,
      cancelled_at: to === "cancelled" ? now : sub.cancelled_at,
      paused_until: null,
      next_retry_at: null,
      ...extra,
    },
  });
  await tx.subscriptionInvoice.updateMany({ where: { subscription_id: sub.id, status: "pending" }, data: { status: "failed" } });
  await expireSubscriptionEnrollments(tx, sub.id);
  onSubscriptionStatus(sub, sub.status, to);
}

// ───────────────────────── 가입 ─────────────────────────

export interface SubscribeResult {
  subscription: Subscription;
  invoice: SubscriptionInvoice;
  pay: { orderId: string; amount: number; orderName: string };
}

/**
 * 구독 신청. 첫 청구는 pending이고, 토스나 모의로 결제하면 active가 된다.
 * 이미 active·past_due·paused 구독이 있으면 409 ALREADY_SUBSCRIBED.
 * 결제하지 않고 그만둔 가입이 있으면 새로 만들지 않고 그 가입과 청구를 지금 기준으로 고쳐 다시 쓴다.
 */
export async function subscribe(userId: string, planCode: string, card: { card_last4: string }, now: Date = new Date()): Promise<SubscribeResult> {
  assertCard(card.card_last4);
  const { subscription, invoice } = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscribe:${userId}`}))`;
      const plan = await tx.plan.findUnique({ where: { code: planCode } });
      if (!plan || !plan.active) throw new HttpError(404, "PLAN_NOT_FOUND", "구독 상품을 찾지 못했어요.");
      const alive = await tx.subscription.findFirst({ where: { user_id: userId, status: { in: ALIVE } } });
      if (alive) throw new HttpError(409, "ALREADY_SUBSCRIBED", "이미 구독 중이에요.");
      const start = now;
      const end = periodEnd(start, plan.interval as Interval);
      const starter = await tx.subscription.findFirst({
        where: {
          user_id: userId,
          status: "expired",
          invoices: { some: { status: "pending" }, none: { status: { in: ["paid", "refunded", "failed"] } } },
        },
        include: { invoices: true },
        orderBy: { created_at: "desc" },
      });
      if (starter) {
        const pending = starter.invoices.find((i) => i.status === "pending")!;
        const subscription = await tx.subscription.update({
          where: { id: starter.id },
          data: { plan_id: plan.id, current_period_start: start, current_period_end: end, card_last4: card.card_last4, cancel_at_period_end: false },
        });
        const invoice = await tx.subscriptionInvoice.update({
          where: { id: pending.id },
          data: { period_start: start, period_end: end, amount: plan.price },
        });
        return { subscription, invoice };
      }
      const subscription = await tx.subscription.create({
        data: {
          user_id: userId,
          plan_id: plan.id,
          status: "expired",
          current_period_start: start,
          current_period_end: end,
          card_label: "모의 카드",
          card_last4: card.card_last4,
        },
      });
      const invoice = await tx.subscriptionInvoice.create({
        data: { subscription_id: subscription.id, period_start: start, period_end: end, amount: plan.price },
      });
      return { subscription, invoice };
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
  const p = await prepareInvoicePayment(invoice.id, tossEnabled() ? "toss" : "mock", now);
  return { subscription, invoice, pay: { orderId: p.orderId, amount: p.amount, orderName: p.orderName } };
}

/**
 * 토스 키가 없을 때 가입 직후 첫 청구를 모의 정기 결제로 바로 낸다(끝 4000 카드는 실패).
 * 실패하면 402 PAYMENT_FAILED이고 가입은 결제 전 상태로 남아 다시 신청할 수 있다.
 */
export async function payFirstInvoiceMock(invoiceId: string, now: Date = new Date()): Promise<void> {
  const r = await chargeMockInvoice(invoiceId, now);
  if (!r.ok) throw new HttpError(402, "PAYMENT_FAILED", r.reason ?? "카드 승인이 되지 않았어요.");
}

// ───────────────────────── 구독으로 듣기 ─────────────────────────

/**
 * 구독 대상 강의를 처음 열 때 구독 수강권을 만든다(source=subscription, expires_at=null).
 * 구독이 active·past_due일 때만. 살아 있는 구매 수강권이 있으면 그것을 그대로 쓴다(구매가 구독보다 앞선다).
 * 지난 구독·만료된 구매로 남은 행이 있으면 지금 구독으로 다시 살린다(진도는 따로 남아 있어 이어진다).
 */
export async function grantSubscriptionAccess(userId: string, courseId: string, now: Date = new Date()): Promise<Enrollment | null> {
  const course = await db.course.findUnique({ where: { id: courseId }, select: { in_subscription: true, status: true } });
  if (!course?.in_subscription || course.status !== "published") return null;
  const sub = await db.subscription.findFirst({ where: { user_id: userId, status: { in: PLAYABLE } }, orderBy: { created_at: "desc" } });
  if (!sub) return null;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`enroll:${userId}:${courseId}`}))`;
    const cur = await tx.enrollment.findUnique({ where: { user_id_course_id: { user_id: userId, course_id: courseId } } });
    if (cur && cur.status === "active" && cur.source !== "subscription" && (cur.expires_at === null || cur.expires_at > now)) return cur;
    if (cur && cur.status === "active" && cur.source === "subscription" && cur.subscription_id === sub.id) return cur;
    if (cur) {
      return tx.enrollment.update({
        where: { id: cur.id },
        data: { source: "subscription", subscription_id: sub.id, order_item_id: null, status: "active", starts_at: now, expires_at: null },
      });
    }
    return tx.enrollment.create({
      data: { user_id: userId, course_id: courseId, source: "subscription", subscription_id: sub.id, starts_at: now, expires_at: null },
    });
  });
}

/**
 * 이 강의를 지금 들을 수 있는 수강권. 구매·무료 수강권이 살아 있으면 그것, 아니면 구독으로 만든다.
 * 둘 다 없으면 403 NO_ACCESS. (재생 API의 lectureAccess가 미리보기가 아닌 강에서 이것을 부른다.)
 */
export async function courseAccess(userId: string, courseId: string, now: Date = new Date()): Promise<Enrollment> {
  const e = (await activeEnrollment(userId, courseId, now)) ?? (await grantSubscriptionAccess(userId, courseId, now));
  if (!e) throw new HttpError(403, "NO_ACCESS", "수강권이 있어야 볼 수 있어요.");
  return e;
}

// ───────────────────────── 해지 예약·일시정지·카드 ─────────────────────────

/** 해지 예약: 기간 끝까지 듣고, 그 뒤 결제 없이 cancelled. */
export async function cancelAtPeriodEnd(userId: string, subId: string): Promise<Subscription> {
  return withSubLock(subId, async (tx) => {
    const s = await ownSub(tx, userId, subId);
    if (!ALIVE.includes(s.status)) throw new HttpError(409, "BAD_STATE", "이미 끝난 구독이에요.");
    if (s.cancel_at_period_end) return s;
    const out = await tx.subscription.update({ where: { id: s.id }, data: { cancel_at_period_end: true } });
    await recordMessage(
      tx, s.user, "subscription_cancel_scheduled", "구독 해지 예약",
      `해지를 예약했어요. ${kstDay(s.current_period_end)}까지 들을 수 있고, 그 뒤에는 결제하지 않아요. 마음이 바뀌면 마이페이지에서 해지 예약을 취소할 수 있어요.`,
    );
    return out;
  });
}

/** 해지 예약 취소. */
export async function undoCancel(userId: string, subId: string): Promise<Subscription> {
  return withSubLock(subId, async (tx) => {
    const s = await ownSub(tx, userId, subId);
    if (!ALIVE.includes(s.status)) throw new HttpError(409, "BAD_STATE", "이미 끝난 구독이에요. 다시 구독해 주세요.");
    if (!s.cancel_at_period_end) return s;
    return tx.subscription.update({ where: { id: s.id }, data: { cancel_at_period_end: false } });
  });
}

/** 일시정지: active일 때만 바로 시작. 1~30일, 최근 365일에 2번까지. 기간 끝을 정지 일수만큼 미룬다. */
export async function pause(userId: string, subId: string, days: number, now: Date = new Date()): Promise<Subscription> {
  return withSubLock(subId, async (tx) => {
    const s = await ownSub(tx, userId, subId);
    if (s.status !== "active") throw new HttpError(409, "BAD_STATE", "구독을 이용 중일 때만 일시정지할 수 있어요.");
    const check = canPause(pausesOf(s), days, now);
    if (!check.ok) throw new HttpError(400, "PAUSE_NOT_ALLOWED", check.reason_ko);
    const until = new Date(now.getTime() + days * DAY_MS);
    const pauses = [...((Array.isArray(s.pauses) ? s.pauses : []) as unknown as PauseRec[]), { start: now.toISOString(), days }];
    const out = await tx.subscription.update({
      where: { id: s.id },
      data: {
        status: "paused",
        paused_until: until,
        current_period_end: new Date(s.current_period_end.getTime() + days * DAY_MS),
        pauses: pauses as unknown as Prisma.InputJsonValue,
      },
    });
    await recordMessage(
      tx, s.user, "subscription_paused", "구독 일시정지",
      `구독을 ${days}일 동안 멈췄어요. ${kstDay(until)}에 다시 시작하고, 멈춘 만큼 이번 기간이 늘어나요. 멈춘 동안에는 구독 강의를 볼 수 없어요.`,
    );
    onSubscriptionStatus(s, s.status, "paused");
    return out;
  });
}

/** 일찍 풀기: 남은 온전한 날 수만큼 기간 끝을 당긴다. */
export async function resume(userId: string, subId: string, now: Date = new Date()): Promise<Subscription> {
  return withSubLock(subId, async (tx) => {
    const s = await ownSub(tx, userId, subId);
    if (s.status !== "paused" || !s.paused_until) throw new HttpError(409, "BAD_STATE", "일시정지 중인 구독이 아니에요.");
    const out = await tx.subscription.update({
      where: { id: s.id },
      data: { status: "active", paused_until: null, current_period_end: resumeEarly(s.current_period_end, s.paused_until, now) },
    });
    onSubscriptionStatus(s, s.status, "active");
    return out;
  });
}

/** 결제 카드 바꾸기 (모의 카드 끝 4자리). 결제가 밀린(past_due) 구독이면 바로 다시 결제한다. */
export async function changeCard(userId: string, subId: string, last4: string, now: Date = new Date()): Promise<Subscription> {
  assertCard(last4);
  const s = await withSubLock(subId, async (tx) => {
    const cur = await ownSub(tx, userId, subId);
    if (!ALIVE.includes(cur.status)) throw new HttpError(409, "BAD_STATE", "이미 끝난 구독이에요.");
    return tx.subscription.update({ where: { id: cur.id }, data: { card_last4: last4, card_label: "모의 카드" } });
  });
  if (s.status === "past_due") await retryOne(subId, now, true);
  return db.subscription.findUniqueOrThrow({ where: { id: subId } });
}

// ───────────────────────── 결제 실패·재시도 ─────────────────────────

/** 결제 실패 하나를 기록하고 afterFailure 규칙대로 past_due(다음 재시도) 또는 expired. */
async function recordFailure(subId: string, invoiceId: string, now: Date, reason: string | undefined): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${subId} FOR UPDATE`;
    const s = await tx.subscription.findUniqueOrThrow({ where: { id: subId }, include: { user: true, plan: true } });
    const firstTime = s.status !== "past_due";
    const count = firstTime ? 1 : s.failure_count + 1;
    const first = firstTime || !s.first_failed_at ? now : s.first_failed_at;
    const next = afterFailure(count, first);
    if (next.status === "expired") {
      await endSubscription(tx, s, "expired", now, { failure_count: count, first_failed_at: first });
      await tx.subscriptionInvoice.update({ where: { id: invoiceId }, data: { status: "failed" } });
      await recordMessage(tx, s.user, "subscription_expired", "구독 종료", EXPIRED_TEXT);
      return;
    }
    await tx.subscription.update({
      where: { id: s.id },
      data: { status: "past_due", failure_count: count, first_failed_at: first, next_retry_at: next.next_retry_at },
    });
    await recordMessage(
      tx, s.user, "subscription_payment_failed", "구독 결제 실패",
      `구독 결제(${won(s.plan.price)})가 되지 않았어요. ${reason ?? ""} ${kstDay(next.next_retry_at)}에 다시 결제할게요. 그동안에도 강의는 들을 수 있어요. 마이페이지 › 구독에서 카드를 바꾸면 바로 다시 결제해요.`.replace(/\s+/g, " "),
    );
    if (firstTime) onSubscriptionStatus(s, s.status, "past_due");
  });
}

/**
 * past_due 구독의 대기 청구를 다시 결제한다. force가 아니면 재시도 시각이 된 것만.
 * 성공하면 onInvoicePaid가 active로 바꾸고, 실패하면 afterFailure 규칙을 따른다. 결제를 시도했으면 true/false, 안 했으면 null.
 */
async function retryOne(subId: string, now: Date, force: boolean): Promise<boolean | null> {
  return withSubLock(subId, async () => {
    const s = await db.subscription.findUnique({ where: { id: subId } });
    if (!s || s.status !== "past_due" || s.cancel_at_period_end) return null;
    if (!force && !(s.next_retry_at && s.next_retry_at <= now)) return null;
    const inv = await db.subscriptionInvoice.findFirst({ where: { subscription_id: s.id, status: "pending" }, orderBy: { period_start: "desc" } });
    if (!inv) return null;
    const r = await chargeMockInvoice(inv.id, now);
    if (r.ok) return true;
    await recordFailure(s.id, inv.id, now, r.reason);
    return false;
  });
}

/** 직원 화면의 "지금 다시 결제". past_due일 때만. 결과는 afterFailure 규칙을 그대로 따른다. */
export async function retryInvoiceNow(actor: string, subId: string, now: Date = new Date()): Promise<Subscription> {
  const s = await db.subscription.findUnique({ where: { id: subId } });
  if (!s) throw NOT_FOUND();
  if (s.status !== "past_due") throw new HttpError(409, "BAD_STATE", "결제가 밀린 구독만 다시 결제할 수 있어요.");
  const r = await retryOne(subId, now, true);
  await audit(actor, "subscription.retry", `subscription:${subId}`, { result: r === null ? "skipped" : r ? "paid" : "failed" });
  return db.subscription.findUniqueOrThrow({ where: { id: subId } });
}

// ───────────────────────── 주기 작업 ─────────────────────────

/** 구독 하나 갱신: 새 기간 청구를 만들 수 있었을 때만 결제한다. */
async function renewOne(subId: string, now: Date): Promise<boolean> {
  return withSubLock(subId, async () => {
    const s = await db.subscription.findUnique({ where: { id: subId }, include: { plan: true } });
    if (!s || s.status !== "active" || s.cancel_at_period_end || !renewalDue(s.current_period_end, now)) return false;
    const start = s.current_period_end;
    const end = periodEnd(start, s.plan.interval as Interval);
    const rows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO subscription_invoices (id, subscription_id, period_start, period_end, amount, status, attempts, created_at, updated_at)
      VALUES (
        ${randomUUID()}, ${s.id},
        (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC'), (${end.toISOString()}::timestamptz AT TIME ZONE 'UTC'),
        ${s.plan.price}::int, 'pending', 0, NOW(), NOW()
      )
      ON CONFLICT (subscription_id, period_start) DO NOTHING
      RETURNING id`;
    if (!rows.length) return false;
    const r = await chargeMockInvoice(rows[0].id, now);
    if (!r.ok) await recordFailure(s.id, rows[0].id, now, r.reason);
    return true;
  });
}

/** 기간 끝 24시간 전이 된 active 구독(해지 예약 아님)을 모의 정기 결제로 갱신. 청구를 새로 만든 수. */
export async function renewSubscriptions(now: Date): Promise<number> {
  const due = await db.subscription.findMany({
    where: { status: "active", cancel_at_period_end: false, current_period_end: { lte: new Date(now.getTime() + 24 * 3600_000) } },
    select: { id: true },
    orderBy: { current_period_end: "asc" },
  });
  let n = 0;
  for (const { id } of due) if (await renewOne(id, now)) n++;
  return n;
}

/** 재시도 시각이 된 past_due 구독을 다시 결제. 시도한 수. */
export async function retryFailedInvoices(now: Date): Promise<number> {
  const due = await db.subscription.findMany({
    where: { status: "past_due", cancel_at_period_end: false, next_retry_at: { lte: now } },
    select: { id: true },
    orderBy: { next_retry_at: "asc" },
  });
  let n = 0;
  for (const { id } of due) if ((await retryOne(id, now, false)) !== null) n++;
  return n;
}

/** 기간이 끝난 해지 예약 → cancelled + 구독 수강권 만료. */
export async function endSubscriptions(now: Date): Promise<number> {
  const due = await db.subscription.findMany({
    where: { status: { in: ALIVE }, cancel_at_period_end: true, current_period_end: { lte: now } },
    select: { id: true },
  });
  let n = 0;
  for (const { id } of due) {
    const done = await withSubLock(id, async (tx) => {
      const s = await loadSub(tx, id);
      if (!s || !ALIVE.includes(s.status) || !s.cancel_at_period_end || s.current_period_end > now) return false;
      await endSubscription(tx, s, "cancelled", now);
      await recordMessage(tx, s.user, "subscription_cancelled", "구독 해지 완료", "예약한 대로 구독이 끝났어요. 진도는 남아 있어 다시 구독하면 이어서 볼 수 있어요.");
      return true;
    });
    if (done) n++;
  }
  return n;
}

/** 일시정지 기간이 지난 구독 → active. */
export async function resumePaused(now: Date): Promise<number> {
  const due = await db.subscription.findMany({ where: { status: "paused", paused_until: { lte: now } }, select: { id: true } });
  let n = 0;
  for (const { id } of due) {
    const done = await withSubLock(id, async (tx) => {
      const s = await loadSub(tx, id);
      if (!s || s.status !== "paused" || !s.paused_until || s.paused_until > now) return false;
      await tx.subscription.update({ where: { id }, data: { status: "active", paused_until: null } });
      await recordMessage(tx, s.user, "subscription_resumed", "구독 다시 시작", "일시정지가 끝나 구독이 다시 시작됐어요. 이어서 들어 보세요.");
      onSubscriptionStatus(s, "paused", "active");
      return true;
    });
    if (done) n++;
  }
  return n;
}

// ───────────────────────── 조회 ─────────────────────────

/** 이 회원의 지금 구독 (살아 있는 것, 없으면 가장 최근 것). 결제 전 가입은 빼고 본다. */
export async function currentSubscription(userId: string) {
  const include = { plan: true, invoices: { orderBy: { period_start: "desc" as const }, take: 12 } };
  const alive = await db.subscription.findFirst({ where: { user_id: userId, status: { in: ALIVE } }, include, orderBy: { created_at: "desc" } });
  if (alive) return alive;
  return db.subscription.findFirst({
    where: { user_id: userId, invoices: { some: { status: { in: ["paid", "refunded"] } } } },
    include,
    orderBy: { created_at: "desc" },
  });
}

/** 화면·API에 내보내는 구독 모양. */
export function subscriptionView(s: Subscription & { plan?: Plan }) {
  return {
    id: s.id,
    status: s.status,
    plan: s.plan ? { code: s.plan.code, name: s.plan.name, interval: s.plan.interval, price: s.plan.price } : null,
    current_period_start: s.current_period_start.toISOString(),
    current_period_end: s.current_period_end.toISOString(),
    cancel_at_period_end: s.cancel_at_period_end,
    failure_count: s.failure_count,
    next_retry_at: s.next_retry_at?.toISOString() ?? null,
    paused_until: s.paused_until?.toISOString() ?? null,
    pauses: pausesOf(s).map((p) => ({ start: p.start.toISOString(), days: p.days })),
    card: { label: s.card_label, last4: s.card_last4 },
    cancelled_at: s.cancelled_at?.toISOString() ?? null,
  };
}

export function invoiceView(i: SubscriptionInvoice) {
  return {
    id: i.id,
    period_start: i.period_start.toISOString(),
    period_end: i.period_end.toISOString(),
    amount: i.amount,
    status: i.status,
    attempts: i.attempts,
    paid_at: i.paid_at?.toISOString() ?? null,
  };
}
