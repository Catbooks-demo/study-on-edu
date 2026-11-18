import { describe, expect, it } from "vitest";
import { effectivePrice } from "@/rules/pricing";

const T = new Date("2026-11-30T14:59:59Z");
const course = { price: 99_000, sale_price: 69_000, sale_ends_at: T };

describe("effectivePrice", () => {
  it("sale before end", () => {
    expect(effectivePrice(course, new Date(T.getTime() - 1))).toEqual({ unit: 69_000, onSale: true });
  });

  it("sale at end", () => {
    expect(effectivePrice(course, T)).toEqual({ unit: 99_000, onSale: false });
  });

  it("no sale", () => {
    expect(effectivePrice({ price: 99_000, sale_price: null, sale_ends_at: null }, T)).toEqual({ unit: 99_000, onSale: false });
  });

  it("sale price without an end date is not applied", () => {
    expect(effectivePrice({ price: 99_000, sale_price: 69_000, sale_ends_at: null }, T)).toEqual({ unit: 99_000, onSale: false });
  });

  it("sale price not lower than list is not a sale", () => {
    const at = new Date(T.getTime() - 1000);
    expect(effectivePrice({ price: 99_000, sale_price: 99_000, sale_ends_at: T }, at)).toEqual({ unit: 99_000, onSale: false });
  });
});
