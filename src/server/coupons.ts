import { Prisma, type Coupon, type Order } from "@prisma/client";
import { type CouponRule, type PriceLine, couponApplies } from "@/rules/pricing";
import { won } from "@/lib/format";
import { HttpError } from "./http";
import type { Tx } from "./tx";

/** 쿠폰 번호는 앞뒤 공백을 빼고 대문자로 맞춘다. */
export const normalizeCode = (code: string) => code.trim().toUpperCase();

/** DB 쿠폰 → 가격 규칙. 강사 대상은 강사 id로 바꾼다(PriceLine.instructor_ids가 id라서). */
export async function couponRule(tx: Tx, c: Coupon): Promise<CouponRule> {
  let target_ref = c.target_ref;
  if (c.target === "instructor") {
    target_ref =
      c.instructor_id ?? (c.target_ref ? (await tx.instructor.findUnique({ where: { slug: c.target_ref } }))?.id ?? null : null);
  }
  return {
    kind: c.kind === "fixed" ? "fixed" : "percent",
    value: c.value,
    max_discount: c.max_discount,
    min_amount: c.min_amount,
    target: (["all", "category", "course", "instructor"] as const).find((t) => t === c.target) ?? "all",
    target_ref,
  };
}

/**
 * 쿠폰 확인. 쿠폰 행을 잠그고(SELECT … FOR UPDATE) 기간·1인 1회·총수량을 본다.
 * lines를 주면 이 주문 줄에 쓸 수 있는지(대상·최소 금액)도 본다.
 * 잠금은 트랜잭션 끝까지 가므로, 같은 쿠폰을 쓰는 주문은 차례로 처리된다.
 */
export async function validateCoupon(tx: Tx, code: string, userId: string, lines: PriceLine[] | null, now: Date): Promise<Coupon> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM coupons WHERE code = ${normalizeCode(code)} FOR UPDATE`;
  const c = rows.length ? await tx.coupon.findUnique({ where: { id: rows[0].id } }) : null;
  if (!c || !c.active) throw new HttpError(404, "COUPON_NOT_FOUND", "쿠폰 번호를 다시 확인해 주세요.");
  if (now < c.starts_at || now >= c.ends_at) throw new HttpError(400, "COUPON_EXPIRED", "사용 기간이 아닌 쿠폰이에요.");
  if (c.per_user_once) {
    const used = await tx.couponRedemption.findUnique({ where: { coupon_id_user_id: { coupon_id: c.id, user_id: userId } } });
    if (used) throw new HttpError(409, "COUPON_USED", "이미 쓴 쿠폰이에요.");
  }
  if (c.total_limit !== null && c.used_count >= c.total_limit) {
    throw new HttpError(409, "COUPON_EXHAUSTED", "준비한 수량이 모두 소진된 쿠폰이에요.");
  }
  if (lines) {
    const rule = await couponRule(tx, c);
    const subtotal = lines.filter((l) => couponApplies(rule, l)).reduce((a, l) => a + l.unit, 0);
    if (subtotal <= 0) throw new HttpError(400, "COUPON_NOT_APPLICABLE", "이 주문에는 쓸 수 없는 쿠폰이에요.");
    if (c.min_amount !== null && subtotal < c.min_amount) {
      throw new HttpError(400, "COUPON_MIN_AMOUNT", `${won(c.min_amount)} 이상 주문에 쓸 수 있는 쿠폰이에요.`);
    }
  }
  return c;
}

/**
 * 쿠폰 사용 기록: 쓴 수를 1 늘리고, 1인 1회 쿠폰이면 coupon_redemptions에 넣는다.
 * 1인 1회가 아닌 쿠폰은 같은 사람이 여러 번 쓸 수 있으므로 사용 기록 행을 만들지 않는다
 * (coupon_redemptions는 (쿠폰, 사람)당 하나라서). 누가 어느 주문에 썼는지는 orders.coupon_id로 안다.
 */
export async function redeemCoupon(tx: Tx, c: Coupon, userId: string, orderId: string): Promise<void> {
  await tx.coupon.update({ where: { id: c.id }, data: { used_count: { increment: 1 } } });
  if (!c.per_user_once) return;
  try {
    await tx.couponRedemption.create({ data: { coupon_id: c.id, user_id: userId, order_id: orderId } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new HttpError(409, "COUPON_USED", "이미 쓴 쿠폰이에요.");
    }
    throw e;
  }
}

/** 결제 전에 취소·만료되거나 쿠폰을 바꾼 주문: 사용 기록을 지우고 쓴 수를 1 줄인다. 환불 때는 부르지 않는다(기록을 남긴다). */
export async function releaseCoupon(tx: Tx, order: Pick<Order, "id" | "coupon_id">): Promise<void> {
  if (!order.coupon_id) return;
  await tx.couponRedemption.deleteMany({ where: { order_id: order.id } });
  await tx.coupon.updateMany({ where: { id: order.coupon_id, used_count: { gt: 0 } }, data: { used_count: { decrement: 1 } } });
}
