import { Prisma, type Refund } from "@prisma/client";
import { refundDueAt } from "@/rules/deadlines";
import { type RefundQuote, courseRefund, subscriptionRefund } from "@/rules/refund";
import { audit } from "./audit";
import { db } from "./db";
import { refundEnrollments } from "./enrollments";
import { onOrderRefunded } from "./hooks";
import { HttpError } from "./http";
import { subscriptionWatchedSec, usageFor } from "./learning-usage";
import { log } from "./log";
import { recordMessage, won } from "./messages";
import { lockOrder } from "./orders";
import { refundPayments } from "./payments";
import { ALIVE, endSubscription } from "./subscriptions";
import type { Tx } from "./tx";

const OPEN = ["requested", "approved"];
const REFUNDABLE_ORDER = ["paid", "partially_refunded"];

const itemInclude = { order: true, course: true, bundle: { include: { courses: true } } } as const;
type ItemCtx = Prisma.OrderItemGetPayload<{ include: typeof itemInclude }>;

const NOT_FOUND = () => new HttpError(404, "NOT_FOUND", "주문 항목을 찾지 못했어요.");

function assertRefundable(item: ItemCtx): void {
  if (item.status !== "active" || !REFUNDABLE_ORDER.includes(item.order.status) || !item.order.paid_at) {
    throw new HttpError(409, "NOT_REFUNDABLE", "환불할 수 없는 항목이에요.");
  }
}

/** 이 항목의 지금 환불 계산. 패키지는 묶음 강의의 모든 강을 합치고 패키지 수강 기간을 쓴다. */
async function quoteItem(item: ItemCtx, now: Date): Promise<RefundQuote> {
  const courseIds = item.course_id ? [item.course_id] : (item.bundle?.courses.map((bc) => bc.course_id) ?? []);
  const access_days = item.course ? item.course.access_days : (item.bundle?.access_days ?? null);
  return courseRefund({
    paid: item.paid_amount,
    paid_at: item.order.paid_at!,
    now,
    access_days,
    lectures: await usageFor(item.order.user_id, courseIds),
  });
}

/** 환불 미리 보기 (경과일·진도·공제 근거). 남의 항목이면 404. */
export async function previewRefund(userId: string, orderItemId: string, now: Date = new Date()): Promise<RefundQuote> {
  const item = await db.orderItem.findUnique({ where: { id: orderItemId }, include: itemInclude });
  if (!item || item.order.user_id !== userId) throw NOT_FOUND();
  assertRefundable(item);
  return quoteItem(item, now);
}

async function lockRefund(tx: Tx, id: string): Promise<Refund> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM refunds WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw new HttpError(404, "NOT_FOUND", "환불 요청을 찾지 못했어요.");
  return tx.refund.findUniqueOrThrow({ where: { id } });
}

const asJson = (q: RefundQuote) => q as unknown as Prisma.InputJsonValue;

/**
 * 환불 신청. 항목을 잠그고(FOR UPDATE) 살아 있는지, 열린 요청이 없는지 본다.
 * 그 시점 계산을 basis에 남긴다. 두 번 눌러도 요청은 하나만 생긴다(잠금 + 부분 unique 인덱스).
 */
export async function requestRefund(userId: string, orderItemId: string, reason: string, now: Date = new Date()): Promise<Refund> {
  try {
    return await db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM order_items WHERE id = ${orderItemId} FOR UPDATE`;
        if (!rows.length) throw NOT_FOUND();
        const item = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, include: itemInclude });
        if (item.order.user_id !== userId) throw NOT_FOUND();
        assertRefundable(item);
        const open = await tx.refund.findFirst({ where: { order_item_id: item.id, status: { in: OPEN } } });
        if (open) throw new HttpError(409, "REFUND_OPEN", "이미 환불 신청이 들어가 있어요.");
        const q = await quoteItem(item, now);
        const refund = await tx.refund.create({
          data: { user_id: userId, order_item_id: item.id, reason: reason.trim(), basis: asJson(q), calc_amount: q.refund, amount: q.refund },
        });
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        await recordMessage(
          tx, user, "refund_requested", "환불 신청 접수",
          `환불 신청을 받았어요. 담당자가 확인해 승인하면 승인한 날부터 5일 안에 돌려드려요. (주문번호 ${item.order.code} · 예상 환불액 ${won(q.refund)})`,
        );
        return refund;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new HttpError(409, "REFUND_OPEN", "이미 환불 신청이 들어가 있어요.");
    }
    throw e;
  }
}

/**
 * 직원 승인. 환불 행을 잠그고 requested일 때만 approved로 바꾼다(아니면 409 BAD_STATE):
 * 직원 두 명이 동시에 눌러도 한 명만 통과하고 돈은 한 번만 나간다.
 * 지금 시각으로 다시 계산하고, 금액을 바꾸면 사유가 필수다. 결제사 환불이 끝나면 done, 실패하면 approved로 남겨 작업이 다시 시도한다.
 */
export async function approveRefund(
  refundId: string,
  staffId: string,
  opts: { amount?: number; reason?: string } = {},
  now: Date = new Date(),
): Promise<Refund> {
  await db.$transaction(
    async (tx) => {
      const r = await lockRefund(tx, refundId);
      if (r.status !== "requested") throw new HttpError(409, "BAD_STATE", "이미 처리된 환불 요청이에요.");
      let q: RefundQuote;
      let paid: number;
      if (r.invoice_id) {
        const inv = await lockInvoiceCtx(tx, r.invoice_id);
        assertInvoiceRefundable(inv, false);
        q = await quoteInvoice(inv, now);
        paid = inv.amount;
      } else {
        const item = await tx.orderItem.findUniqueOrThrow({ where: { id: r.order_item_id! }, include: itemInclude });
        assertRefundable(item);
        q = await quoteItem(item, now);
        paid = item.paid_amount;
      }
      const amount = opts.amount ?? q.refund;
      if (!Number.isInteger(amount) || amount < 0 || amount > paid) {
        throw new HttpError(400, "BAD_AMOUNT", `환불액은 0원부터 낸 금액(${won(paid)})까지만 정할 수 있어요.`);
      }
      const adjust = opts.reason?.trim() || null;
      if (amount !== q.refund && !adjust) throw new HttpError(400, "REASON_REQUIRED", "금액을 바꾸면 사유를 적어 주세요.");
      const changed = await tx.refund.updateMany({
        where: { id: r.id, status: "requested" },
        data: {
          status: "approved",
          basis: asJson(q),
          calc_amount: q.refund,
          amount,
          adjust_reason: amount !== q.refund ? adjust : null,
          decided_by: staffId,
          approved_at: now,
        },
      });
      if (changed.count !== 1) throw new HttpError(409, "BAD_STATE", "이미 처리된 환불 요청이에요.");
      if (r.invoice_id) await cancelForRefund(tx, r.invoice_id, now);
      await audit(`staff:${staffId}`, "refund.approve", `refund:${r.id}`, { calc_amount: q.refund, amount, adjust_reason: adjust }, tx);
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
  return settleRefund(refundId, now);
}

/**
 * 승인된 환불을 결제사로 돌려주고 마무리한다(승인 직후와 주기 작업 retryRefunds가 부른다).
 * 결제사가 실패하면 approved로 둔 채 돌려준다. 같은 요청 몫은 refund_id로 세므로 다시 불러도 두 번 돌려주지 않는다.
 */
export async function settleRefund(refundId: string, now: Date = new Date()): Promise<Refund> {
  const r = await db.refund.findUniqueOrThrow({ where: { id: refundId }, include: { order_item: true } });
  if (r.status !== "approved") return r;
  if (r.invoice_id) return settleInvoiceRefund(r, now);
  if (!r.order_item) return r;
  try {
    await refundPayments({ orderId: r.order_item.order_id }, r.amount, `환불: ${r.reason}`.slice(0, 200), { refundId: r.id });
  } catch (e) {
    log.warn("환불 결제사 처리 실패, 작업이 다시 시도", { refundId, error: e instanceof Error ? e.message : String(e) });
    return db.refund.findUniqueOrThrow({ where: { id: refundId } });
  }
  return db.$transaction(
    async (tx) => {
      const cur = await lockRefund(tx, refundId);
      if (cur.status !== "approved") return cur;
      const item = await tx.orderItem.findUniqueOrThrow({ where: { id: cur.order_item_id! } });
      const order = await lockOrder(tx, { id: item.order_id });
      const done = await tx.refund.update({ where: { id: cur.id }, data: { status: "done", done_at: now } });
      await tx.orderItem.update({ where: { id: item.id }, data: { status: "refunded", refunded_amount: cur.amount } });
      const stillActive = await tx.orderItem.count({ where: { order_id: order.id, status: "active" } });
      const after = await tx.order.update({
        where: { id: order.id },
        data: { refunded_amount: { increment: cur.amount }, status: stillActive ? "partially_refunded" : "refunded" },
      });
      await refundEnrollments(tx, item.id, now);
      const user = await tx.user.findUniqueOrThrow({ where: { id: cur.user_id } });
      await onOrderRefunded(tx, after, user, { refund_id: cur.id, order_item_id: item.id, amount: cur.amount }, now);
      await recordMessage(
        tx, user, "refund_done", "환불 완료",
        `환불이 끝났어요. ${won(cur.amount)}을 결제한 수단으로 돌려드렸어요. (주문번호 ${order.code})`,
      );
      return done;
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
}

/** 직원 거절 (사유 필수). requested일 때만. */
export async function rejectRefund(refundId: string, staffId: string, reason: string): Promise<Refund> {
  const why = reason.trim();
  if (!why) throw new HttpError(400, "REASON_REQUIRED", "거절 사유를 적어 주세요.");
  return db.$transaction(async (tx) => {
    const r = await lockRefund(tx, refundId);
    if (r.status !== "requested") throw new HttpError(409, "BAD_STATE", "이미 처리된 환불 요청이에요.");
    const out = await tx.refund.update({ where: { id: r.id }, data: { status: "rejected", reject_reason: why, decided_by: staffId } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: r.user_id } });
    await recordMessage(tx, user, "refund_rejected", "환불 신청 결과", `환불 신청을 승인하지 못했어요. 사유: ${why} 궁금한 점은 1:1 문의로 남겨 주세요.`);
    await audit(`staff:${staffId}`, "refund.reject", `refund:${r.id}`, { reason: why }, tx);
    return out;
  });
}

/** 결제사 실패로 approved에 남은 환불 id (주기 작업용). */
export async function stuckRefundIds(): Promise<string[]> {
  const rows = await db.refund.findMany({ where: { status: "approved" }, select: { id: true }, orderBy: { approved_at: "asc" } });
  return rows.map((r) => r.id);
}

/** 화면·API에 내보내는 환불 모양. */
export function refundView(r: Refund) {
  return {
    id: r.id,
    status: r.status,
    reason: r.reason,
    calc_amount: r.calc_amount,
    amount: r.amount,
    adjust_reason: r.adjust_reason,
    reject_reason: r.reject_reason,
    basis: r.basis,
    created_at: r.created_at.toISOString(),
    approved_at: r.approved_at?.toISOString() ?? null,
    due_at: r.approved_at ? refundDueAt(r.approved_at).toISOString() : null,
    done_at: r.done_at?.toISOString() ?? null,
  };
}

// ───────────────────────── 구독 환불 ─────────────────────────

const invoiceInclude = { subscription: { include: { plan: true } } } as const;
type InvoiceCtx = Prisma.SubscriptionInvoiceGetPayload<{ include: typeof invoiceInclude }>;

async function lockInvoiceCtx(tx: Tx, id: string): Promise<InvoiceCtx> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM subscription_invoices WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw new HttpError(404, "NOT_FOUND", "구독 청구를 찾지 못했어요.");
  return tx.subscriptionInvoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
}

/** 결제된 청구여야 한다. 신청할 때는 구독도 살아 있어야 한다(승인은 그 사이 기간이 끝났어도 할 수 있다). */
function assertInvoiceRefundable(inv: InvoiceCtx, needAlive = true): void {
  if (inv.status !== "paid" || !inv.paid_at || (needAlive && !ALIVE.includes(inv.subscription.status))) {
    throw new HttpError(409, "NOT_REFUNDABLE", "환불할 수 있는 구독 결제가 없어요.");
  }
}

/** 구독 청구 환불 계산: 7일 이내 미시청 전액, 그 밖에는 max(기간 경과, 그 기간 구독 시청 ÷ 기준 시간) 공제. */
async function quoteInvoice(inv: InvoiceCtx, now: Date): Promise<RefundQuote> {
  return subscriptionRefund({
    paid: inv.amount,
    paid_at: inv.paid_at!,
    period_start: inv.period_start,
    period_end: inv.period_end,
    now,
    watched_sec: await subscriptionWatchedSec(inv.subscription_id, inv.period_start, inv.period_end),
    base_hours: inv.subscription.plan.refund_base_hours,
  });
}

/** 환불할 청구: 지금이 든 기간의 결제된 청구, 없으면 가장 최근에 결제된 청구. */
async function refundableInvoiceId(subId: string, now: Date): Promise<string | null> {
  const paid = await db.subscriptionInvoice.findMany({
    where: { subscription_id: subId, status: "paid" },
    orderBy: { period_start: "desc" },
    select: { id: true, period_start: true, period_end: true },
  });
  const current = paid.find((i) => i.period_start <= now && now < i.period_end);
  return (current ?? paid[0])?.id ?? null;
}

/** 구독 환불 미리 보기. 본인 구독만(아니면 404). */
export async function previewSubscriptionRefund(userId: string, subId: string, now: Date = new Date()): Promise<RefundQuote & { invoice_id: string }> {
  const sub = await db.subscription.findUnique({ where: { id: subId } });
  if (!sub || sub.user_id !== userId) throw new HttpError(404, "NOT_FOUND", "구독을 찾지 못했어요.");
  const invId = await refundableInvoiceId(subId, now);
  if (!invId) throw new HttpError(409, "NOT_REFUNDABLE", "환불할 수 있는 구독 결제가 없어요.");
  const inv = await db.subscriptionInvoice.findUniqueOrThrow({ where: { id: invId }, include: invoiceInclude });
  assertInvoiceRefundable(inv);
  return { ...(await quoteInvoice(inv, now)), invoice_id: inv.id };
}

/**
 * 구독 환불 신청: 그 기간 청구를 잠그고 열린 요청이 없을 때만 만든다(두 번 눌러도 하나).
 * basis는 subscriptionRefund, 시청은 그 기간 subscriptionWatchedSec.
 */
export async function requestSubscriptionRefund(userId: string, subId: string, reason: string, now: Date = new Date()): Promise<Refund> {
  const sub = await db.subscription.findUnique({ where: { id: subId } });
  if (!sub || sub.user_id !== userId) throw new HttpError(404, "NOT_FOUND", "구독을 찾지 못했어요.");
  const invId = await refundableInvoiceId(subId, now);
  if (!invId) throw new HttpError(409, "NOT_REFUNDABLE", "환불할 수 있는 구독 결제가 없어요.");
  try {
    return await db.$transaction(
      async (tx) => {
        const inv = await lockInvoiceCtx(tx, invId);
        assertInvoiceRefundable(inv);
        const open = await tx.refund.findFirst({ where: { invoice_id: inv.id, status: { in: OPEN } } });
        if (open) throw new HttpError(409, "REFUND_OPEN", "이미 환불 신청이 들어가 있어요.");
        const q = await quoteInvoice(inv, now);
        const refund = await tx.refund.create({
          data: { user_id: userId, invoice_id: inv.id, reason: reason.trim(), basis: asJson(q), calc_amount: q.refund, amount: q.refund },
        });
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        await recordMessage(
          tx, user, "refund_requested", "환불 신청 접수",
          `구독 환불 신청을 받았어요. 승인되면 구독은 바로 끝나고, 승인한 날부터 5일 안에 돌려드려요. (${inv.subscription.plan.name} · 예상 환불액 ${won(q.refund)})`,
        );
        return refund;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new HttpError(409, "REFUND_OPEN", "이미 환불 신청이 들어가 있어요.");
    }
    throw e;
  }
}

/** 구독 환불 승인 때: 구독을 바로 cancelled로 (구독 수강권 만료, 남은 대기 청구는 failed). */
async function cancelForRefund(tx: Tx, invoiceId: string, now: Date): Promise<void> {
  const inv = await tx.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  // 갱신·재시도와 같은 구독 잠금: 진행 중인 갱신 결제가 끝난 뒤에 해지한다(해지된 구독이 다시 active가 되지 않게).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sub:${inv.subscription_id}`}))`;
  await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${inv.subscription_id} FOR UPDATE`;
  const sub = await tx.subscription.findUniqueOrThrow({ where: { id: inv.subscription_id } });
  if (!ALIVE.includes(sub.status)) return;
  await endSubscription(tx, sub, "cancelled", now, { cancel_at_period_end: false });
}

/** 승인된 구독 환불을 결제사로 돌려주고 마무리 (청구 refunded). */
async function settleInvoiceRefund(r: Refund, now: Date): Promise<Refund> {
  try {
    await refundPayments({ invoiceId: r.invoice_id! }, r.amount, `구독 환불: ${r.reason}`.slice(0, 200), { refundId: r.id });
  } catch (e) {
    log.warn("구독 환불 결제사 처리 실패, 작업이 다시 시도", { refundId: r.id, error: e instanceof Error ? e.message : String(e) });
    return db.refund.findUniqueOrThrow({ where: { id: r.id } });
  }
  return db.$transaction(
    async (tx) => {
      const cur = await lockRefund(tx, r.id);
      if (cur.status !== "approved") return cur;
      const inv = await lockInvoiceCtx(tx, cur.invoice_id!);
      const done = await tx.refund.update({ where: { id: cur.id }, data: { status: "done", done_at: now } });
      await tx.subscriptionInvoice.update({ where: { id: inv.id }, data: { status: "refunded" } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: cur.user_id } });
      await recordMessage(
        tx, user, "refund_done", "환불 완료",
        `환불이 끝났어요. ${won(cur.amount)}을 결제한 수단으로 돌려드렸어요. (${inv.subscription.plan.name})`,
      );
      return done;
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
}
