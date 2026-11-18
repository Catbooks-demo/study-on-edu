import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as mockRoute } from "@/app/api/payments/mock/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { addToCart } from "@/server/cart";
import { db } from "@/server/db";
import { resetEnvCache } from "@/server/env";
import { cancelPendingOrder, createOrder } from "@/server/orders";
import {
  chargeMockInvoice,
  confirmPayment,
  mockPay,
  mockPayInvoice,
  preparePayment,
  reconcilePending,
  refundPayments,
} from "@/server/payments";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { loginCookie, makeCourse, makeSubscription, makeUser } from "./helpers/fixtures";

function useToss(on: boolean) {
  if (on) {
    process.env.TOSS_CLIENT_KEY = "test_ck_dummy";
    process.env.TOSS_SECRET_KEY = "test_sk_dummy";
  } else {
    delete process.env.TOSS_CLIENT_KEY;
    delete process.env.TOSS_SECRET_KEY;
  }
  resetEnvCache();
}

/** 토스 가짜: 승인·취소는 요청 본문을 돌려주고, 조회는 lookup 값을 돌려준다. */
function tossFetch(lookup?: { orderId: string; totalAmount: number }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") {
      return new Response(JSON.stringify({ status: "DONE", ...lookup }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ status: "DONE", ...body }), { status: 200 });
  });
}

async function pendingOrder(price = 99_000) {
  const user = await makeUser();
  const { course } = await makeCourse({ price });
  await addToCart(user.id, { course_code: course.code });
  const order = await createOrder(user.id, {});
  return { user, course, order };
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  useToss(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useToss(false);
});

describe("토스 결제", () => {
  it("confirm grants enrollments", async () => {
    useToss(true);
    vi.stubGlobal("fetch", tossFetch());
    const { user, course, order } = await pendingOrder();
    const p = await preparePayment(order.code);
    expect(p.amount).toBe(99_000);
    expect(p.orderName).toContain("시험 강의");
    const r = await confirmPayment({ orderId: p.orderId, paymentKey: "pk_test_1", amount: p.amount });
    expect(r.order?.status).toBe("paid");
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("paid");
    expect(after.paid_at).not.toBeNull();
    const e = await db.enrollment.findUniqueOrThrow({ where: { user_id_course_id: { user_id: user.id, course_id: course.id } } });
    expect(e.status).toBe("active");
    expect(e.source).toBe("order");
    const m = await db.message.findFirstOrThrow({ where: { user_id: user.id, kind: "payment_done" } });
    expect(m.body).toContain("결제가 완료됐어요. 내 강의실에서 바로 들을 수 있어요.");
  });

  it("same orderId twice → 1 payment row, fetch once", async () => {
    useToss(true);
    const f = tossFetch();
    vi.stubGlobal("fetch", f);
    const { order } = await pendingOrder();
    const p = await preparePayment(order.code);
    const req = { orderId: p.orderId, paymentKey: "pk_test_1", amount: p.amount };
    await confirmPayment(req);
    await confirmPayment(req);
    expect(f).toHaveBeenCalledTimes(1);
    expect(await db.payment.count({ where: { order_id: order.id, kind: "charge", status: "approved" } })).toBe(1);
    expect(await db.enrollment.count()).toBe(1);
  });

  it("amount mismatch 400", async () => {
    useToss(true);
    const f = tossFetch();
    vi.stubGlobal("fetch", f);
    const { order } = await pendingOrder();
    const p = await preparePayment(order.code);
    await expect(confirmPayment({ orderId: p.orderId, paymentKey: "pk", amount: 1000 })).rejects.toMatchObject({ status: 400 });
    expect(f).not.toHaveBeenCalled();
  });

  it("expired order confirm → refunded + 409", async () => {
    useToss(true);
    const f = tossFetch();
    vi.stubGlobal("fetch", f);
    const { order } = await pendingOrder();
    const p = await preparePayment(order.code);
    await db.$transaction((tx) => cancelPendingOrder(tx, order.id, "결제 기한이 지났어요."));
    await expect(confirmPayment({ orderId: p.orderId, paymentKey: "pk_late", amount: p.amount })).rejects.toMatchObject({
      status: 409,
      code: "ORDER_CLOSED",
    });
    const refunds = await db.payment.findMany({ where: { order_id: order.id, kind: "refund", status: "approved" } });
    expect(refunds.map((r) => r.amount)).toEqual([99_000]);
    expect(f).toHaveBeenCalledTimes(2); // 승인 + 취소
    expect(await db.enrollment.count()).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("cancelled");
  });

  it("toss rejection marks the payment failed", async () => {
    useToss(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "REJECT_CARD_COMPANY", message: "카드사 거절" }), { status: 400 })));
    const { order } = await pendingOrder();
    const p = await preparePayment(order.code);
    await expect(confirmPayment({ orderId: p.orderId, paymentKey: "pk", amount: p.amount })).rejects.toMatchObject({ status: 402 });
    expect((await db.payment.findUniqueOrThrow({ where: { toss_order_id: p.orderId } })).status).toBe("failed");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("pending");
  });

  it("toss timeout leaves pending", async () => {
    useToss(true);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("connect ETIMEDOUT"))));
    const { order } = await pendingOrder();
    const p = await preparePayment(order.code);
    await expect(confirmPayment({ orderId: p.orderId, paymentKey: "pk_slow", amount: p.amount })).rejects.toMatchObject({
      status: 502,
      code: "PAYMENT_PENDING",
    });
    const pay = await db.payment.findUniqueOrThrow({ where: { toss_order_id: p.orderId } });
    expect(pay.status).toBe("pending");
    expect(pay.toss_payment_key).toBe("pk_slow");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("pending");

    // 나중에 토스가 승인으로 답하면 주기 작업이 반영한다
    vi.stubGlobal("fetch", tossFetch({ orderId: p.orderId, totalAmount: p.amount }));
    expect(await reconcilePending(new Date(Date.now() + 2 * 60_000))).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("paid");
  });
});

describe("모의 결제", () => {
  it("mockPay grants and records one approved row", async () => {
    const { user, order } = await pendingOrder();
    const paid = await mockPay(order.code);
    expect(paid.status).toBe("paid");
    expect(await db.payment.count({ where: { order_id: order.id, method: "mock", status: "approved" } })).toBe(1);
    expect(await db.enrollment.count({ where: { user_id: user.id, status: "active" } })).toBe(1);
    await expect(mockPay(order.code)).rejects.toMatchObject({ status: 409 });
  });

  it("mockPay 403 with toss keys", async () => {
    useToss(true);
    const { order } = await pendingOrder();
    await expect(mockPay(order.code)).rejects.toMatchObject({ status: 403 });
  });

  it("expired order cannot be prepared", async () => {
    const { order } = await pendingOrder();
    await expect(mockPay(order.code, new Date(Date.now() + 31 * 60_000))).rejects.toMatchObject({ status: 409, code: "ORDER_EXPIRED" });
  });

  it("mock route is owner only", async () => {
    const { user, order } = await pendingOrder();
    const other = await makeUser();
    expect((await call(mockRoute, { cookies: await loginCookie(other.id), body: { code: order.code } })).status).toBe(404);
    const r = await call(mockRoute, { cookies: await loginCookie(user.id), body: { code: order.code } });
    expect(r.status).toBe(200);
    expect(r.body.order).toMatchObject({ code: order.code, status: "paid" });
  });
});

describe("환불 나누기", () => {
  /** 결제 행 두 개(30,000 먼저, 70,000 나중)가 승인된 주문. */
  async function twoCharges() {
    const { order } = await pendingOrder(100_000);
    await db.order.update({ where: { id: order.id }, data: { status: "paid", paid_at: new Date() } });
    const t = Date.now();
    await db.payment.create({ data: { order_id: order.id, kind: "charge", method: "mock", amount: 30_000, status: "approved", approved_at: new Date(t - 60_000) } });
    await db.payment.create({ data: { order_id: order.id, kind: "charge", method: "mock", amount: 70_000, status: "approved", approved_at: new Date(t) } });
    return order;
  }

  it("refundPayments splits latest-first", async () => {
    const order = await twoCharges();
    expect(await refundPayments({ orderId: order.id }, 90_000, "환불")).toBe(90_000);
    const rows = await db.payment.findMany({
      where: { order_id: order.id, kind: "refund" },
      include: { refund_of: true },
      orderBy: { created_at: "asc" },
    });
    expect(rows.map((r) => [r.refund_of?.amount, r.amount, r.status])).toEqual([
      [70_000, 70_000, "approved"],
      [30_000, 20_000, "approved"],
    ]);
  });

  it("never refunds more than was paid", async () => {
    const order = await twoCharges();
    expect(await refundPayments({ orderId: order.id }, 90_000, "환불")).toBe(90_000);
    expect(await refundPayments({ orderId: order.id }, 50_000, "더")).toBe(10_000);
    expect(await refundPayments({ orderId: order.id }, 1, "더")).toBe(0);
  });
});

describe("구독 청구 결제", () => {
  async function invoiceFor(card_last4: string) {
    const user = await makeUser();
    const sub = await makeSubscription(user.id);
    await db.subscription.update({ where: { id: sub.id }, data: { card_last4 } });
    return db.subscriptionInvoice.create({
      data: { subscription_id: sub.id, period_start: sub.current_period_start, period_end: sub.current_period_end, amount: 29_000 },
    });
  }

  it("mock card 4000 fails", async () => {
    const inv = await invoiceFor("4000");
    const r = await chargeMockInvoice(inv.id, new Date());
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(await db.payment.count({ where: { invoice_id: inv.id, status: "failed" } })).toBe(1);
    expect((await db.subscriptionInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).not.toBe("paid");
  });

  it("other mock card succeeds and marks the invoice paid", async () => {
    const inv = await invoiceFor("1234");
    expect(await chargeMockInvoice(inv.id, new Date())).toEqual({ ok: true });
    expect((await db.subscriptionInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("paid");
    expect(await db.payment.count({ where: { invoice_id: inv.id, status: "approved" } })).toBe(1);
  });

  it("mockPayInvoice marks the invoice paid", async () => {
    const inv = await invoiceFor("1234");
    const r = await mockPayInvoice(inv.id);
    expect(r.invoice?.status).toBe("paid");
  });
});
