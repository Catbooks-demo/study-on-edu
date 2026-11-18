import type { Order, OrderItem } from "@prisma/client";
import { type CouponRule, type PriceLine, priceOrder } from "@/rules/pricing";
import { LIMITS, enforceLimit } from "./auth/ratelimit";
import { BUNDLE_CATEGORY, cartLines } from "./cart";
import { nextOrderCode } from "./codes";
import { couponRule, normalizeCode, redeemCoupon, releaseCoupon, validateCoupon } from "./coupons";
import { db } from "./db";
import { ownsCourse } from "./enrollments";
import { HttpError } from "./http";
import { recordMessage } from "./messages";
import type { Tx } from "./tx";

/** 결제 전 주문이 살아 있는 시간. 지나면 주기 작업이 cancelled로 바꾼다. */
export const ORDER_TTL_MIN = 30;

/** 결제(주문 만들기·결제 준비·승인) 요청 제한: 계정 20회/분, IP 60회/분. */
export function enforceCheckoutLimit(userId: string, ip: string, now = Date.now()): void {
  enforceLimit(`checkout:ip:${ip}`, ...LIMITS.checkout.ip, now);
  enforceLimit(`checkout:user:${userId}`, ...LIMITS.checkout.user, now);
}

/** 주문 행 잠그기 (SELECT … FOR UPDATE). 없으면 404. */
export async function lockOrder(tx: Tx, where: { id: string } | { code: string }): Promise<Order> {
  const rows =
    "id" in where
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${where.id} FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE code = ${where.code} FOR UPDATE`;
  if (!rows.length) throw new HttpError(404, "NOT_FOUND", "주문을 찾지 못했어요.");
  return tx.order.findUniqueOrThrow({ where: { id: rows[0].id } });
}

export type CreateOrderInput = {
  coupon_code?: string | null;
  /** 판매가를 정하는 시각. 대기열 순번표 시각 가격(Task 22)용이라 서버 안에서만 넘긴다. */
  price_at?: Date;
};

/**
 * 장바구니로 주문을 만든다 (트랜잭션 하나).
 * 쿠폰은 장바구니를 읽기 전에 잠그고 확인한다: 같은 쿠폰을 동시에 쓰는 주문은 차례로 돌고, 뒤 주문은 앞 주문이 남긴 기록을 본다.
 */
export async function createOrder(userId: string, input: CreateOrderInput, now: Date = new Date()): Promise<Order> {
  const code = input.coupon_code ? normalizeCode(input.coupon_code) : null;
  return db.$transaction(
    async (tx) => {
      if (code) await validateCoupon(tx, code, userId, null, now);
      const lines = await cartLines(tx, userId, input.price_at ?? now);
      if (!lines.length) throw new HttpError(400, "EMPTY_CART", "장바구니가 비어 있어요.");
      for (const l of lines) {
        if (l.course_id && (await ownsCourse(tx, userId, l.course_id, now))) {
          throw new HttpError(409, "ALREADY_ENROLLED", "이미 수강 중인 강의예요.");
        }
      }
      const coupon = code ? await validateCoupon(tx, code, userId, lines, now) : null;
      const rule: CouponRule | null = coupon ? await couponRule(tx, coupon) : null;
      const p = priceOrder(lines, rule);
      const order = await tx.order.create({
        data: {
          code: await nextOrderCode(tx, now),
          user_id: userId,
          list_total: p.list_total,
          discount_total: p.discount_total,
          coupon_id: coupon?.id ?? null,
          coupon_discount: p.coupon_discount,
          payable: p.payable,
          status: "pending",
          expires_at: new Date(now.getTime() + ORDER_TTL_MIN * 60_000),
          items: {
            create: p.lines.map((l, i) => ({
              kind: lines[i].kind,
              course_id: lines[i].course_id,
              bundle_id: lines[i].bundle_id,
              list_price: l.list,
              unit_price: l.unit,
              coupon_share: l.coupon_share,
              paid_amount: l.paid,
            })),
          },
        },
      });
      if (coupon) await redeemCoupon(tx, coupon, userId, order.id);
      await tx.cartItem.deleteMany({ where: { user_id: userId } });
      return order;
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
}

/** 주문 항목 → 가격 규칙 줄 (주문 때 정한 가격 그대로). */
async function linesFromItems(tx: Tx, items: OrderItem[]): Promise<PriceLine[]> {
  const out: PriceLine[] = [];
  for (const it of items) {
    if (it.course_id) {
      const c = await tx.course.findUniqueOrThrow({ where: { id: it.course_id }, include: { category: true } });
      out.push({ key: c.code, category: c.category.code, course_code: c.code, instructor_ids: [c.instructor_id], list: it.list_price, unit: it.unit_price });
    } else {
      const b = await tx.bundle.findUniqueOrThrow({ where: { id: it.bundle_id! }, include: { courses: { include: { course: true } } } });
      out.push({
        key: b.code,
        category: BUNDLE_CATEGORY,
        course_code: null,
        instructor_ids: [...new Set(b.courses.map((bc) => bc.course.instructor_id))],
        list: it.list_price,
        unit: it.unit_price,
      });
    }
  }
  return out;
}

/**
 * 주문서에서 쿠폰 넣기·바꾸기·빼기 (결제 전 주문만). 예전 쿠폰 기록은 풀고, 새 쿠폰은 같은 규칙으로 확인한다.
 * 금액이 바뀌므로 이미 준비한 결제창은 다시 열어야 한다(결제 준비가 새 금액으로 다시 만든다).
 */
export async function applyOrderCoupon(userId: string, orderCode: string, couponCode: string | null, now: Date = new Date()): Promise<Order> {
  const code = couponCode ? normalizeCode(couponCode) : null;
  return db.$transaction(
    async (tx) => {
      const order = await lockOrder(tx, { code: orderCode });
      if (order.user_id !== userId) throw new HttpError(404, "NOT_FOUND", "주문을 찾지 못했어요.");
      if (order.status !== "pending" || order.expires_at <= now) {
        throw new HttpError(409, "ORDER_CLOSED", "결제할 수 없는 주문이에요. 장바구니에서 다시 주문해 주세요.");
      }
      const current = order.coupon_id ? await tx.coupon.findUnique({ where: { id: order.coupon_id } }) : null;
      if ((current?.code ?? null) === code) return order;
      await releaseCoupon(tx, order);
      const items = await tx.orderItem.findMany({ where: { order_id: order.id }, orderBy: { created_at: "asc" } });
      const lines = await linesFromItems(tx, items);
      const coupon = code ? await validateCoupon(tx, code, userId, lines, now) : null;
      const p = priceOrder(lines, coupon ? await couponRule(tx, coupon) : null);
      for (const [i, it] of items.entries()) {
        await tx.orderItem.update({ where: { id: it.id }, data: { coupon_share: p.lines[i].coupon_share, paid_amount: p.lines[i].paid } });
      }
      if (coupon) await redeemCoupon(tx, coupon, userId, order.id);
      return tx.order.update({
        where: { id: order.id },
        data: { coupon_id: coupon?.id ?? null, coupon_discount: p.coupon_discount, payable: p.payable },
      });
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
}

/**
 * 결제 전 주문 취소 (만료·수강생 취소). 잠근 뒤 아직 pending일 때만 바꾸고, 쿠폰 사용 기록을 지우고 쓴 수를 1 줄인다.
 * 바꿨으면 true.
 */
export async function cancelPendingOrder(tx: Tx, orderId: string, why: string): Promise<boolean> {
  const order = await lockOrder(tx, { id: orderId });
  if (order.status !== "pending") return false;
  await tx.order.update({ where: { id: order.id }, data: { status: "cancelled" } });
  await releaseCoupon(tx, order);
  const user = await tx.user.findUniqueOrThrow({ where: { id: order.user_id } });
  await recordMessage(tx, user, "order_cancelled", "주문 취소", `${why} (주문번호 ${order.code})`);
  return true;
}

/** 수강생 본인 주문 (항목·강의·패키지·쿠폰 포함). 남의 주문이면 404. */
export async function getOrderForUser(userId: string, code: string) {
  const order = await db.order.findUnique({
    where: { code },
    include: {
      coupon: true,
      items: {
        orderBy: { created_at: "asc" },
        include: {
          course: { include: { category: true, instructor: true } },
          bundle: true,
          refunds: { orderBy: { created_at: "desc" } },
        },
      },
    },
  });
  if (!order || order.user_id !== userId) throw new HttpError(404, "NOT_FOUND", "주문을 찾지 못했어요.");
  return order;
}

export type OrderDetail = Awaited<ReturnType<typeof getOrderForUser>>;

/** 화면·API에 내보내는 주문 모양. */
export function orderView(o: OrderDetail) {
  return {
    code: o.code,
    status: o.status,
    list_total: o.list_total,
    discount_total: o.discount_total,
    coupon_code: o.coupon?.code ?? null,
    coupon_discount: o.coupon_discount,
    payable: o.payable,
    refunded_amount: o.refunded_amount,
    paid_at: o.paid_at?.toISOString() ?? null,
    expires_at: o.expires_at.toISOString(),
    created_at: o.created_at.toISOString(),
    items: o.items.map((it) => ({
      id: it.id,
      kind: it.kind,
      code: it.course?.code ?? it.bundle?.code ?? "",
      title: it.course?.title ?? it.bundle?.title ?? "",
      category: it.course?.category.code ?? BUNDLE_CATEGORY,
      instructor_name: it.course?.instructor.display_name ?? null,
      list_price: it.list_price,
      unit_price: it.unit_price,
      coupon_share: it.coupon_share,
      paid_amount: it.paid_amount,
      refunded_amount: it.refunded_amount,
      status: it.status,
      refund: it.refunds[0]
        ? { id: it.refunds[0].id, status: it.refunds[0].status, amount: it.refunds[0].amount, created_at: it.refunds[0].created_at.toISOString() }
        : null,
    })),
  };
}

export type OrderView = ReturnType<typeof orderView>;

/** 내 주문 목록 (최근 순). */
export async function listOrdersForUser(userId: string, take = 50) {
  return db.order.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
    take,
    include: { items: { include: { course: true, bundle: true }, orderBy: { created_at: "asc" } } },
  });
}
