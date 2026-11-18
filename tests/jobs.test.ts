import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { addToCart } from "@/server/cart";
import { db } from "@/server/db";
import { resetEnvCache } from "@/server/env";
import { runJobsOnce, withJobLock } from "@/server/jobs";
import { createOrder } from "@/server/orders";
import { confirmPayment, preparePayment } from "@/server/payments";
import { approveRefund, requestRefund } from "@/server/refunds";
import { resetDb } from "./helpers/db";
import { makeCoupon, makeCourse, makeStaff, makeUser } from "./helpers/fixtures";

const MIN = 60_000;

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

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  useToss(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useToss(false);
});

describe("주기 작업", () => {
  it("expire pending order after 30 min", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    const coupon = await makeCoupon({ code: "WELCOME10", value: 10, maxDiscount: 10_000, perUserOnce: true });
    await addToCart(user.id, { course_code: course.code });
    const now = new Date();
    const order = await createOrder(user.id, { coupon_code: "WELCOME10" }, now);
    expect(await db.couponRedemption.count()).toBe(1);

    const early = await runJobsOnce(new Date(now.getTime() + 29 * MIN));
    expect(early.expireOrders).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("pending");

    const r1 = await runJobsOnce(new Date(now.getTime() + 31 * MIN));
    const r2 = await runJobsOnce(new Date(now.getTime() + 32 * MIN));
    expect(r1.expireOrders).toBe(1);
    expect(r2.expireOrders).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("cancelled");
    expect(await db.couponRedemption.count()).toBe(0);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).used_count).toBe(0);
    expect(await db.jobRun.count({ where: { name: "expireOrders", ok: true } })).toBe(3);
  });

  it("job lock", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    // 다른 연결(트랜잭션 하나가 연결을 붙잡는다)이 세션 잠금을 쥔다
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_lock(hashtext('job:expireOrders'))`;
        locked();
        await held;
        await tx.$executeRaw`SELECT pg_advisory_unlock(hashtext('job:expireOrders'))`;
      },
      { timeout: 30_000 },
    );
    await isLocked;
    const fn = vi.fn(async () => 1);
    const r = await withJobLock("expireOrders", fn);
    release();
    await holder;
    expect(r).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(await withJobLock("expireOrders", fn)).toBe(1);
  });

  it("retry stuck refund", async () => {
    useToss(true);
    let cancelOk = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/cancel") && !cancelOk) {
          return new Response(JSON.stringify({ code: "PROVIDER_ERROR", message: "결제사 점검 중" }), { status: 500 });
        }
        const body = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({ status: "DONE", ...body }), { status: 200 });
      }),
    );
    const user = await makeUser();
    const { course } = await makeCourse({ price: 99_000 });
    await addToCart(user.id, { course_code: course.code });
    const order = await createOrder(user.id, {});
    const p = await preparePayment(order.code);
    await confirmPayment({ orderId: p.orderId, paymentKey: "pk_retry", amount: p.amount });
    const item = await db.orderItem.findFirstOrThrow({ where: { order_id: order.id } });
    const staff = await makeStaff("cs");
    const r = await requestRefund(user.id, item.id, "변심");

    const stuck = await approveRefund(r.id, staff.id, {});
    expect(stuck.status).toBe("approved");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("paid");

    cancelOk = true;
    const res = await runJobsOnce();
    expect(res.retryRefunds).toBe(1);
    const done = await db.refund.findUniqueOrThrow({ where: { id: r.id } });
    expect(done.status).toBe("done");
    expect(done.done_at).not.toBeNull();
    const rows = await db.payment.findMany({ where: { order_id: order.id, kind: "refund", status: "approved" } });
    expect(rows.reduce((s, x) => s + x.amount, 0)).toBe(99_000);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("refunded");
    expect((await runJobsOnce()).retryRefunds).toBe(0);
  });
});
