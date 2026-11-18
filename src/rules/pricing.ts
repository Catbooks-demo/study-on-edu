/**
 * 지금 적용되는 판매가. 할인가는 마감 시각 전(at < sale_ends_at)에만 쓴다.
 * 마감이 없는 할인가와 정가보다 싸지 않은 할인가는 할인으로 보지 않는다.
 */
export function effectivePrice(
  c: { price: number; sale_price: number | null; sale_ends_at: Date | null },
  at: Date,
): { unit: number; onSale: boolean } {
  const onSale =
    c.sale_price !== null &&
    c.sale_ends_at !== null &&
    c.sale_price < c.price &&
    at.getTime() < c.sale_ends_at.getTime();
  return onSale ? { unit: c.sale_price!, onSale: true } : { unit: c.price, onSale: false };
}

// ───────────── 쿠폰·주문 가격 ─────────────

export type CouponRule = {
  kind: "fixed" | "percent";
  value: number;
  max_discount: number | null;
  min_amount: number | null;
  target: "all" | "category" | "course" | "instructor";
  target_ref: string | null;
};

/** 주문 한 줄. 패키지는 course_code=null, instructor_ids에 묶음 강사들. */
export type PriceLine = {
  key: string;
  category: string;
  course_code: string | null;
  instructor_ids: string[];
  list: number;
  unit: number;
};

/** 이 줄에 쿠폰을 쓸 수 있는지. 패키지 줄은 대상이 all일 때만. */
export function couponApplies(rule: CouponRule, line: PriceLine): boolean {
  if (rule.target === "all") return true;
  if (line.course_code === null) return false;
  if (rule.target === "category") return line.category === rule.target_ref;
  if (rule.target === "course") return line.course_code === rule.target_ref;
  return rule.target_ref !== null && line.instructor_ids.includes(rule.target_ref);
}

/** 대상 소계에 대한 쿠폰 할인액. 정률은 내림, 최대 할인으로 자르고, 최소 금액보다 작으면 0. */
export function couponDiscount(rule: CouponRule, eligibleSubtotal: number): number {
  if (eligibleSubtotal <= 0) return 0;
  if (rule.min_amount !== null && eligibleSubtotal < rule.min_amount) return 0;
  let d = rule.kind === "fixed" ? rule.value : Math.floor((eligibleSubtotal * rule.value) / 100);
  if (rule.kind === "percent" && rule.max_discount !== null) d = Math.min(d, rule.max_discount);
  return Math.max(0, Math.min(d, eligibleSubtotal));
}

/** 비례 배분: 내림으로 나누고, 남는 원은 가장 큰 가중치(같으면 앞) 하나에 몰아준다. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const out = weights.map((w) => Math.floor((total * w) / sum));
  const rest = total - out.reduce((a, b) => a + b, 0);
  const big = weights.indexOf(Math.max(...weights));
  out[big] += rest;
  return out;
}

export type PricedLine = PriceLine & { coupon_share: number; paid: number };

export interface OrderPricing {
  lines: PricedLine[];
  list_total: number;
  discount_total: number;
  coupon_discount: number;
  payable: number;
}

/** 주문 가격: 쿠폰 할인은 대상 줄의 판매가 비율로 나눈다. 줄별 paid 합 = payable. */
export function priceOrder(lines: PriceLine[], coupon: CouponRule | null): OrderPricing {
  const eligible = lines.map((l) => (coupon ? couponApplies(coupon, l) : false));
  const subtotal = lines.reduce((a, l, i) => a + (eligible[i] ? l.unit : 0), 0);
  const coupon_discount = coupon ? couponDiscount(coupon, subtotal) : 0;
  const idx = lines.map((_, i) => i).filter((i) => eligible[i]);
  const shares = allocate(coupon_discount, idx.map((i) => lines[i].unit));
  const share = new Map(idx.map((i, k) => [i, shares[k]]));
  const priced = lines.map((l, i) => {
    const coupon_share = share.get(i) ?? 0;
    return { ...l, coupon_share, paid: l.unit - coupon_share };
  });
  const unitTotal = lines.reduce((a, l) => a + l.unit, 0);
  return {
    lines: priced,
    list_total: lines.reduce((a, l) => a + l.list, 0),
    discount_total: lines.reduce((a, l) => a + (l.list - l.unit), 0),
    coupon_discount,
    payable: unitTotal - coupon_discount,
  };
}
