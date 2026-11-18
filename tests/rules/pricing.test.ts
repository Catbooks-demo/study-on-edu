import { describe, expect, it } from "vitest";
import { type CouponRule, type PriceLine, allocate, couponApplies, couponDiscount, priceOrder } from "@/rules/pricing";

const rule = (r: Partial<CouponRule>): CouponRule => ({
  kind: "percent",
  value: 10,
  max_discount: null,
  min_amount: null,
  target: "all",
  target_ref: null,
  ...r,
});

const dev: PriceLine = { key: "SO-DEV-0001", category: "DEV", course_code: "SO-DEV-0001", instructor_ids: ["ins-a"], list: 99_000, unit: 69_000 };
const cert: PriceLine = { key: "SO-CERT-0001", category: "CERT", course_code: "SO-CERT-0001", instructor_ids: ["ins-b"], list: 33_000, unit: 33_000 };
const pkg: PriceLine = { key: "SO-PKG-0001", category: "PKG", course_code: null, instructor_ids: ["ins-a", "ins-b"], list: 200_000, unit: 150_000 };

describe("allocate", () => {
  it("rest goes to the biggest weight (first on ties)", () => {
    const out = allocate(10_000, [1, 1, 1]);
    expect(out).toEqual([3334, 3333, 3333]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it("proportional", () => {
    expect(allocate(5000, [99_000, 33_000])).toEqual([3750, 1250]);
  });

  it("sum is exact for awkward weights", () => {
    const out = allocate(10_200, [69_000, 33_000, 1]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(10_200);
  });
});

describe("couponDiscount", () => {
  it("percent with max", () => {
    const r = rule({ kind: "percent", value: 10, max_discount: 10_000 });
    expect(couponDiscount(r, 150_000)).toBe(10_000);
    expect(couponDiscount(r, 69_000)).toBe(6900);
  });

  it("fixed never goes negative", () => {
    expect(couponDiscount(rule({ kind: "fixed", value: 5000 }), 3000)).toBe(3000);
  });

  it("min_amount", () => {
    const r = rule({ kind: "percent", value: 20, min_amount: 100_000 });
    expect(couponDiscount(r, 99_999)).toBe(0);
    expect(couponDiscount(r, 100_000)).toBe(20_000);
  });
});

describe("couponApplies", () => {
  it("targets", () => {
    expect(couponApplies(rule({ target: "all" }), dev)).toBe(true);
    expect(couponApplies(rule({ target: "category", target_ref: "CERT" }), dev)).toBe(false);
    expect(couponApplies(rule({ target: "category", target_ref: "CERT" }), cert)).toBe(true);
    expect(couponApplies(rule({ target: "course", target_ref: "SO-DEV-0001" }), dev)).toBe(true);
    expect(couponApplies(rule({ target: "instructor", target_ref: "ins-b" }), cert)).toBe(true);
    expect(couponApplies(rule({ target: "instructor", target_ref: "ins-b" }), dev)).toBe(false);
  });

  it("package lines only for all", () => {
    expect(couponApplies(rule({ target: "all" }), pkg)).toBe(true);
    expect(couponApplies(rule({ target: "instructor", target_ref: "ins-a" }), pkg)).toBe(false);
    expect(couponApplies(rule({ target: "category", target_ref: "PKG" }), pkg)).toBe(false);
  });
});

describe("priceOrder", () => {
  it("sale + list price + 10% coupon", () => {
    const p = priceOrder([dev, cert], rule({ kind: "percent", value: 10 }));
    expect(p.list_total).toBe(132_000);
    expect(p.discount_total).toBe(30_000);
    expect(p.coupon_discount).toBe(10_200);
    expect(p.payable).toBe(91_800);
    expect(p.lines.map((l) => l.paid)).toEqual([62_100, 29_700]);
    expect(p.lines.reduce((a, l) => a + l.paid, 0)).toBe(p.payable);
  });

  it("category coupon skips other lines", () => {
    const p = priceOrder([dev, cert], rule({ kind: "fixed", value: 5000, target: "category", target_ref: "CERT" }));
    expect(p.lines[0].coupon_share).toBe(0);
    expect(p.lines[1].coupon_share).toBe(5000);
    expect(p.coupon_discount).toBe(5000);
    expect(p.payable).toBe(69_000 + 28_000);
  });

  it("no coupon", () => {
    const p = priceOrder([dev], null);
    expect(p.coupon_discount).toBe(0);
    expect(p.payable).toBe(69_000);
    expect(p.lines[0].paid).toBe(69_000);
  });
});
