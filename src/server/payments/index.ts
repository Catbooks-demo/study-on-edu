import { randomBytes } from "node:crypto";
import type { Order, Payment, SubscriptionInvoice } from "@prisma/client";
import { db } from "../db";
import { grantForOrder } from "../enrollments";
import { tossEnabled } from "../env";
import { onPaymentAttempt, paymentFailRate } from "../hooks";
import { HttpError } from "../http";
import { log } from "../log";
import { recordMessage, won } from "../messages";
import { lockOrder } from "../orders";
import type { Tx } from "../tx";
import { onInvoicePaid } from "./invoice";
import { TossError, tossCancel, tossConfirm, tossLookup } from "./toss";

export type PayMethod = "toss" | "mock";

export interface Prepared {
  orderId: string;
  amount: number;
  orderName: string;
}

/** 승인 결과: 주문 결제면 order, 구독 청구 결제면 invoice. */
export interface ConfirmResult {
  order: Order | null;
  invoice: SubscriptionInvoice | null;
}

const tossOrderId = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex")}`;

async function lockInvoice(tx: Tx, id: string): Promise<SubscriptionInvoice> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM subscription_invoices WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw new HttpError(404, "NOT_FOUND", "청구를 찾지 못했어요.");
  return tx.subscriptionInvoice.findUniqueOrThrow({ where: { id } });
}

/**
 * 주문 결제 준비: 금액은 서버가 정하고 대기 결제 행을 만든다.
 * 주문이 pending이고 결제 기한(expires_at) 전이어야 한다. 같은 주문의 예전 대기 행(결제창만 열었던 것)은 무효로 한다.
 */
export async function preparePayment(orderCode: string, method: PayMethod = "toss", now: Date = new Date()): Promise<Prepared> {
  return db.$transaction(async (tx) => {
    const o = await lockOrder(tx, { code: orderCode });
    if (o.status !== "pending") throw new HttpError(409, "BAD_STATE", "이미 결제했거나 취소된 주문이에요.");
    if (o.expires_at <= now) throw new HttpError(409, "ORDER_EXPIRED", "결제 기한(30분)이 지났어요. 장바구니에서 다시 주문해 주세요.");
    // 토스에 승인을 보내 결과를 기다리는 행(결제 키 있음)은 두고, 창만 열었던 행은 무효
    await tx.payment.updateMany({
      where: { order_id: o.id, kind: "charge", status: "pending", toss_payment_key: null },
      data: { status: "cancelled", failure_reason: "새 결제 준비로 무효" },
    });
    const orderId = tossOrderId(o.code);
    await tx.payment.create({ data: { order_id: o.id, kind: "charge", method, amount: o.payable, status: "pending", toss_order_id: orderId } });
    const items = await tx.orderItem.findMany({ where: { order_id: o.id }, include: { course: true, bundle: true }, orderBy: { created_at: "asc" } });
    const first = items[0]?.course?.title ?? items[0]?.bundle?.title ?? "스터디온에듀 강의";
    const orderName = items.length > 1 ? `${first} 외 ${items.length - 1}건` : first;
    return { orderId, amount: o.payable, orderName: orderName.slice(0, 100) };
  });
}

/** 구독 청구 결제 준비 (구독 첫 결제용). 청구가 pending이어야 한다. */
export async function prepareInvoicePayment(invoiceId: string, method: PayMethod = "toss", now: Date = new Date()): Promise<Prepared> {
  void now;
  return db.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== "pending") throw new HttpError(409, "BAD_STATE", "이미 결제했거나 끝난 청구예요.");
    await tx.payment.updateMany({
      where: { invoice_id: inv.id, kind: "charge", status: "pending", toss_payment_key: null },
      data: { status: "cancelled", failure_reason: "새 결제 준비로 무효" },
    });
    const orderId = tossOrderId(`SOI-${inv.id}`);
    await tx.payment.create({ data: { invoice_id: inv.id, kind: "charge", method, amount: inv.amount, status: "pending", toss_order_id: orderId } });
    const sub = await tx.subscription.findUniqueOrThrow({ where: { id: inv.subscription_id }, include: { plan: true } });
    return { orderId, amount: inv.amount, orderName: `스터디온에듀 ${sub.plan.name}`.slice(0, 100) };
  });
}

type Applied = { ok: boolean; payment: Payment; result: ConfirmResult };

/**
 * 승인된 결제를 주문·청구에 반영. 이미 반영된 결제면 아무것도 안 한다.
 * 받을 수 없는 상태(취소·만료·이미 결제)면 돈만 기록하고 ok=false (호출한 쪽이 바로 환불한다).
 */
async function applyApproved(tx: Tx, paymentId: string, paymentKey: string | null, now: Date): Promise<Applied> {
  const pay0 = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const approve = () =>
    tx.payment.update({
      where: { id: paymentId },
      data: { status: "approved", approved_at: now, toss_payment_key: paymentKey ?? pay0.toss_payment_key, failure_reason: null },
    });

  if (pay0.order_id) {
    const o = await lockOrder(tx, { id: pay0.order_id });
    const pay = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (pay.status === "approved") return { ok: true, payment: pay, result: { order: o, invoice: null } };
    const approved = await approve();
    if (o.status !== "pending") return { ok: false, payment: approved, result: { order: o, invoice: null } };
    const order = await tx.order.update({ where: { id: o.id }, data: { status: "paid", paid_at: now } });
    await grantForOrder(tx, o.id, now);
    const user = await tx.user.findUniqueOrThrow({ where: { id: o.user_id } });
    await recordMessage(
      tx, user, "payment_done", "결제 완료",
      `결제가 완료됐어요. 내 강의실에서 바로 들을 수 있어요. (주문번호 ${o.code} · 결제 금액 ${won(pay.amount)})`,
    );
    return { ok: true, payment: approved, result: { order, invoice: null } };
  }

  const inv = await lockInvoice(tx, pay0.invoice_id!);
  const pay = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (pay.status === "approved") return { ok: true, payment: pay, result: { order: null, invoice: inv } };
  const approved = await approve();
  if (inv.status !== "pending") return { ok: false, payment: approved, result: { order: null, invoice: inv } };
  await onInvoicePaid(tx, inv.id, now);
  const invoice = await tx.subscriptionInvoice.findUniqueOrThrow({ where: { id: inv.id } });
  return { ok: true, payment: approved, result: { order: null, invoice } };
}

/** 승인 반영 → 받을 수 없는 결제면 그 금액만 바로 돌려주고 409. */
async function finishApproved(paymentId: string, paymentKey: string | null, now: Date): Promise<ConfirmResult> {
  const r = await db.$transaction((tx) => applyApproved(tx, paymentId, paymentKey, now));
  if (r.ok) return r.result;
  const target = r.payment.order_id ? { orderId: r.payment.order_id } : { invoiceId: r.payment.invoice_id! };
  await refundPayments(target, r.payment.amount, "받을 수 없는 결제 자동 환불");
  throw new HttpError(409, "ORDER_CLOSED", "주문이 이미 취소돼 이 결제는 받을 수 없어요. 결제 금액은 바로 환불했어요.");
}

async function resultFor(pay: Payment): Promise<ConfirmResult> {
  return {
    order: pay.order_id ? await db.order.findUniqueOrThrow({ where: { id: pay.order_id } }) : null,
    invoice: pay.invoice_id ? await db.subscriptionInvoice.findUniqueOrThrow({ where: { id: pay.invoice_id } }) : null,
  };
}

/** 토스에 실제 승인됐는지 물어 본다 (결과를 모를 때). null = 조회도 안 됨. */
async function approvedAtToss(paymentKey: string, orderId: string, amount: number): Promise<boolean | null> {
  try {
    const t = await tossLookup(paymentKey);
    return t.status === "DONE" && t.orderId === orderId && t.totalAmount === amount;
  } catch {
    return null;
  }
}

/**
 * 토스 결제 승인. 같은 orderId를 다시 보내면 토스를 다시 부르지 않는다.
 * 응답이 끊기거나 "이미 처리됨"이면 토스에 조회해 실제 결과대로 반영한다.
 * 모르면 대기로 두고(502 PAYMENT_PENDING) 주기 작업(reconcilePending)이 다시 확인한다.
 * 주문이 cancelled가 된 뒤 온 승인은 바로 환불하고 409 ORDER_CLOSED.
 */
export async function confirmPayment(p: { orderId: string; paymentKey: string; amount: number }, now: Date = new Date()): Promise<ConfirmResult> {
  const pay = await db.payment.findUnique({ where: { toss_order_id: p.orderId } });
  if (!pay || pay.kind !== "charge") throw new HttpError(404, "NOT_FOUND", "결제 정보를 찾지 못했어요.");
  if (pay.status === "approved") return resultFor(pay);
  if (pay.amount !== p.amount) throw new HttpError(400, "AMOUNT_MISMATCH", "결제 금액이 맞지 않아요.");
  if (pay.status !== "pending") throw new HttpError(409, "BAD_STATE", "이미 끝났거나 무효가 된 결제예요. 주문서에서 다시 결제해 주세요.");

  try {
    await tossConfirm({ paymentKey: p.paymentKey, orderId: p.orderId, amount: p.amount });
  } catch (e) {
    if (!(e instanceof TossError)) throw e;
    if (e.timeout || e.code === "ALREADY_PROCESSED_PAYMENT") {
      // 결제 키를 남겨 두면 주기 작업도 나중에 확인할 수 있다
      await db.payment.updateMany({ where: { id: pay.id, status: "pending" }, data: { toss_payment_key: p.paymentKey } });
      const done = await approvedAtToss(p.paymentKey, p.orderId, p.amount);
      if (done) {
        onPaymentAttempt("toss", true);
        return finishApproved(pay.id, p.paymentKey, now);
      }
      const again = await db.payment.findUniqueOrThrow({ where: { id: pay.id } });
      if (again.status === "approved") return resultFor(again);
      if (done === null || e.timeout) {
        throw new HttpError(502, "PAYMENT_PENDING", "결제 결과를 아직 확인하지 못했어요. 잠시 뒤 주문 내역에서 다시 확인해 주세요.");
      }
    }
    // 아직 대기인 행만 실패로 (다른 요청이 먼저 승인했으면 건드리지 않음)
    await db.payment.updateMany({ where: { id: pay.id, status: "pending" }, data: { status: "failed", failure_reason: `${e.code}: ${e.message}` } });
    const after = await db.payment.findUniqueOrThrow({ where: { id: pay.id } });
    if (after.status === "approved") return resultFor(after);
    onPaymentAttempt("toss", false);
    throw new HttpError(402, "PAYMENT_FAILED", e.message);
  }
  onPaymentAttempt("toss", true);
  return finishApproved(pay.id, p.paymentKey, now);
}

/** 응답이 끊긴 채 남은 토스 결제를 토스에 물어 정리한다 (주기 작업). 반영한 수를 돌려준다. */
export async function reconcilePending(now: Date = new Date()): Promise<number> {
  const stuck = await db.payment.findMany({
    where: { status: "pending", method: "toss", kind: "charge", toss_payment_key: { not: null }, created_at: { lt: new Date(now.getTime() - 60_000) } },
  });
  let n = 0;
  for (const p of stuck) {
    const done = await approvedAtToss(p.toss_payment_key!, p.toss_order_id!, p.amount);
    if (done === null) continue;
    if (done) {
      try {
        await finishApproved(p.id, p.toss_payment_key, now);
      } catch (e) {
        if (!(e instanceof HttpError && e.code === "ORDER_CLOSED")) throw e;
      }
      n++;
    } else {
      await db.payment.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "failed", failure_reason: "토스에서 승인되지 않음" } });
    }
  }
  return n;
}

/** 모의 결제 (토스 키가 없을 때만. 0원 주문은 키가 있어도 결제 없이 끝낸다). */
export async function mockPay(orderCode: string, now: Date = new Date()): Promise<Order> {
  const o = await db.order.findUnique({ where: { code: orderCode } });
  if (!o) throw new HttpError(404, "NOT_FOUND", "주문을 찾지 못했어요.");
  if (tossEnabled() && o.payable > 0) throw new HttpError(403, "MOCK_DISABLED", "모의 결제는 쓸 수 없어요.");
  const prepared = await preparePayment(orderCode, "mock", now);
  const pay = await db.payment.findUniqueOrThrow({ where: { toss_order_id: prepared.orderId } });
  const r = await finishApproved(pay.id, null, now);
  onPaymentAttempt("mock", true);
  return r.order!;
}

/** 구독 청구 모의 결제 (토스 키가 없을 때만). */
export async function mockPayInvoice(invoiceId: string, now: Date = new Date()): Promise<ConfirmResult> {
  if (tossEnabled()) throw new HttpError(403, "MOCK_DISABLED", "모의 결제는 쓸 수 없어요.");
  const prepared = await prepareInvoicePayment(invoiceId, "mock", now);
  const pay = await db.payment.findUniqueOrThrow({ where: { toss_order_id: prepared.orderId } });
  const r = await finishApproved(pay.id, null, now);
  onPaymentAttempt("mock", true);
  return r;
}

/** 시연용 실패 카드: 끝 4자리가 4000이면 늘 거절. */
export const FAIL_CARD_LAST4 = "4000";

/**
 * 구독 갱신용 모의 정기 결제 (Task 15가 쓴다). 실패하면 실패 결제 행을 남기고 {ok:false}.
 * 끝 4자리 4000 카드와 장애 주입(payment_fail_rate)이 실패를 만든다. 청구 상태(past_due 등)는 부르는 쪽이 정한다.
 */
export async function chargeMockInvoice(invoiceId: string, now: Date, rand: () => number = Math.random): Promise<{ ok: boolean; reason?: string }> {
  const inv = await db.subscriptionInvoice.findUnique({ where: { id: invoiceId }, include: { subscription: true } });
  if (!inv) throw new HttpError(404, "NOT_FOUND", "청구를 찾지 못했어요.");
  if (inv.status === "paid") return { ok: true };
  const failCard = inv.subscription.card_last4 === FAIL_CARD_LAST4;
  const injected = !failCard && rand() < paymentFailRate();
  if (failCard || injected) {
    const reason = failCard ? "시연용 실패 카드(끝 4000)라 승인되지 않았어요." : "결제사 승인 실패 (시연용 장애 주입)";
    await db.$transaction([
      db.payment.create({ data: { invoice_id: inv.id, kind: "charge", method: "mock", amount: inv.amount, status: "failed", failure_reason: reason } }),
      db.subscriptionInvoice.update({ where: { id: inv.id }, data: { attempts: { increment: 1 }, last_attempt_at: now } }),
    ]);
    onPaymentAttempt("mock", false);
    return { ok: false, reason };
  }
  await db.$transaction(async (tx) => {
    const locked = await lockInvoice(tx, inv.id);
    if (locked.status !== "pending") return;
    await tx.payment.create({ data: { invoice_id: inv.id, kind: "charge", method: "mock", amount: inv.amount, status: "approved", approved_at: now } });
    await tx.subscriptionInvoice.update({ where: { id: inv.id }, data: { attempts: { increment: 1 }, last_attempt_at: now } });
    await onInvoicePaid(tx, inv.id, now);
  });
  onPaymentAttempt("mock", true);
  return { ok: true };
}

export type RefundTarget = { orderId: string } | { invoiceId: string };

/**
 * 환불의 바탕 (누비투어 refundCore를 주문·청구별로). 대상마다 한 번에 하나만 돈다(advisory lock).
 * - 결과를 모르는 채 남은 환불 행(토스 응답 끊김)은 같은 멱등 키(행 id)로 먼저 다시 보낸다.
 * - 새 환불은 가장 최근 승인 결제부터 거꾸로, 결제마다 남은 환불 가능액만큼 나눈다.
 * - refundId를 주면 그 환불 요청 몫으로 이미 돌려준 금액을 빼고 남은 만큼만 보낸다(다시 시도해도 두 번 돌려주지 않는다).
 * - 결제사가 실패하면 502 REFUND_FAILED (행은 실패 또는 대기로 남는다).
 * 이번에 돌려준 금액을 반환한다.
 */
export async function refundPayments(target: RefundTarget, amount: number, reason: string, opts: { refundId?: string } = {}): Promise<number> {
  const id = "orderId" in target ? target.orderId : target.invoiceId;
  const where = "orderId" in target ? { order_id: id } : { invoice_id: id };
  const refundId = opts.refundId ?? null;
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refund:${id}`}))`;
      let done = 0;

      // 1. 대기로 남은 환불 다시 보내기
      const stuck = await db.payment.findMany({ where: { ...where, kind: "refund", status: "pending", refund_id: refundId }, include: { refund_of: true } });
      for (const row of stuck) done += await sendRefund(row.id, row.amount, row.refund_of!, reason, id);

      // 2. 더 돌려줄 금액
      let left = amount;
      if (refundId) {
        const sent = await db.payment.aggregate({ where: { refund_id: refundId, kind: "refund", status: "approved" }, _sum: { amount: true } });
        left = amount - (sent._sum.amount ?? 0);
      }
      if (left <= 0) return done;
      const pays = await db.payment.findMany({
        where: { ...where, kind: "charge", status: "approved" },
        include: { refunds: { where: { status: { in: ["approved", "pending"] } } } },
        orderBy: [{ approved_at: "desc" }, { created_at: "desc" }],
      });
      for (const p of pays) {
        if (left <= 0) break;
        const refundable = p.amount - p.refunds.reduce((s, r) => s + r.amount, 0);
        const piece = Math.min(left, refundable);
        if (piece <= 0) continue;
        const row = await db.payment.create({
          data: { ...where, kind: "refund", method: p.method, amount: piece, status: "pending", refund_of_id: p.id, refund_id: refundId },
        });
        done += await sendRefund(row.id, piece, p, reason, id);
        left -= piece;
      }
      return done;
    },
    { timeout: 120_000, maxWait: 60_000 },
  );
}

/** 환불 행 하나를 결제사에 보내고 반영. 멱등 키 = 환불 행 id. */
async function sendRefund(rowId: string, amount: number, original: Payment, reason: string, targetId: string): Promise<number> {
  if (original.method === "toss") {
    try {
      if (!original.toss_payment_key) throw new TossError("NO_PAYMENT_KEY", "결제 키가 없어요.");
      await tossCancel(original.toss_payment_key, amount, reason, rowId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof TossError && e.timeout) {
        await db.payment.update({ where: { id: rowId }, data: { failure_reason: `응답 없음, 다시 시도 필요: ${msg}` } });
      } else {
        await db.payment.update({ where: { id: rowId }, data: { status: "failed", failure_reason: msg } });
      }
      log.error("환불 실패", { targetId, paymentId: original.id, amount, error: msg });
      throw new HttpError(502, "REFUND_FAILED", "환불 처리 중 결제사 오류가 났어요. 잠시 후 다시 시도해 주세요.");
    }
  }
  await db.payment.update({ where: { id: rowId }, data: { status: "approved", approved_at: new Date(), failure_reason: null } });
  return amount;
}
