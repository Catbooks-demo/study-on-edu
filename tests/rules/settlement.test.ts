import { describe, expect, it } from "vitest";
import { PAY_DAY, REFERRAL_RATE, SALE_RATE, SUBSCRIPTION_SHARE, payDate, settle } from "@/rules/settlement";

const base = { sales: [], refunds: [], pool: 0, instructor_sec: 0, total_sec: 0, carried_in: 0 };

describe("정산 규칙", () => {
  it("constants", () => {
    expect(SALE_RATE).toBe(0.7);
    expect(REFERRAL_RATE).toBe(0.9);
    expect(SUBSCRIPTION_SHARE).toBe(0.5);
    expect(PAY_DAY).toBe(10);
  });

  it("sales 70% / referral 90%", () => {
    const r = settle({ ...base, sales: [{ amount: 99_000, referral: false }, { amount: 50_000, referral: true }] });
    expect(r.sales_amount).toBe(99_000);
    expect(r.sales_share).toBe(69_300);
    expect(r.referral_amount).toBe(50_000);
    expect(r.referral_share).toBe(45_000);
    expect(r.total).toBe(114_300);
    expect(r.payout).toBe(114_300);
    expect(r.carry_out).toBe(0);
  });

  it("floors each sale line (no float drift)", () => {
    // 0.7 × 29 = 20.299999… → 20, 0.9 × 1,001 = 900.9 → 900
    const r = settle({ ...base, sales: [{ amount: 29, referral: false }, { amount: 29, referral: false }, { amount: 1_001, referral: true }] });
    expect(r.sales_share).toBe(40);
    expect(r.referral_share).toBe(900);
  });

  it("subscription share", () => {
    const r = settle({ ...base, pool: 1_000_000, instructor_sec: 3_600, total_sec: 36_000 });
    expect(r.subscription_share).toBe(50_000);
  });

  it("zero total_sec → 0", () => {
    expect(settle({ ...base, pool: 1_000_000, instructor_sec: 0, total_sec: 0 }).subscription_share).toBe(0);
  });

  it("refund deduction at original rate", () => {
    const r = settle({ ...base, sales: [{ amount: 99_000, referral: false }], refunds: [{ amount: 99_000, rate: 0.7 }] });
    expect(r.refund_deduction).toBe(69_300);
    expect(r.total).toBe(0);
    const ref = settle({ ...base, refunds: [{ amount: 50_000, rate: 0.9 }] });
    expect(ref.refund_deduction).toBe(45_000);
  });

  it("negative carries", () => {
    const r = settle({ ...base, refunds: [{ amount: 99_000, rate: 0.7 }] });
    expect(r.total).toBe(-69_300);
    expect(r.payout).toBe(0);
    expect(r.carry_out).toBe(-69_300);
    // 다음 달 carried_in으로 들어간다
    const next = settle({ ...base, sales: [{ amount: 200_000, referral: false }], carried_in: r.carry_out });
    expect(next.carried_in).toBe(-69_300);
    expect(next.total).toBe(140_000 - 69_300);
    expect(next.payout).toBe(70_700);
    expect(next.carry_out).toBe(0);
  });

  it("payDate", () => {
    expect(payDate("2026-11")).toBe("2026-12-10");
    expect(payDate("2026-12")).toBe("2027-01-10");
  });
});
