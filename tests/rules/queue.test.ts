import { describe, expect, it } from "vitest";
import { HOLD_AFTER_SALE_MS, admitCount, etaSeconds, heldPriceAt } from "@/rules/queue";

const T = 1_800_000_000_000;

describe("대기열 규칙", () => {
  it("rate 10, 1s elapsed, 100 waiting → n 10", () => {
    expect(admitCount(T, T + 1000, 10, 100)).toEqual({ n: 10, next_last_admit_at_ms: T + 1000 });
  });

  it("0.25s, rate 10 → n 2, clock advances 200ms (소수 몫 보존)", () => {
    const a = admitCount(T, T + 250, 10, 100);
    expect(a).toEqual({ n: 2, next_last_admit_at_ms: T + 200 });
    const b = admitCount(a.next_last_admit_at_ms, T + 300, 10, 98);
    expect(b.n).toBe(1);
  });

  it("burst cap: 1시간 쉼, rate 10, 대기 1000 → n 100", () => {
    expect(admitCount(T, T + 3_600_000, 10, 1000).n).toBe(100);
  });

  it("all admitted → next = now", () => {
    expect(admitCount(T, T + 5000, 10, 3)).toEqual({ n: 3, next_last_admit_at_ms: T + 5000 });
  });

  it("nobody waiting → n 0", () => {
    expect(admitCount(T, T + 5000, 10, 0).n).toBe(0);
  });

  it("etaSeconds(25, 10) === 3", () => {
    expect(etaSeconds(25, 10)).toBe(3);
    expect(etaSeconds(0, 10)).toBe(0);
  });

  it("마감 연장: 마감 전 발급 표는 마감 뒤 30분까지 발급 시각 가격", () => {
    const end = new Date(T);
    const issued = new Date(T - 60_000);
    expect(HOLD_AFTER_SALE_MS).toBe(30 * 60_000);
    expect(heldPriceAt(issued, new Date(T + 20 * 60_000), end)).toEqual(issued);
    expect(heldPriceAt(issued, new Date(T + 31 * 60_000), end)).toEqual(new Date(T + 31 * 60_000));
    // 마감 뒤에 받은 표는 연장이 없다
    const late = new Date(T + 60_000);
    expect(heldPriceAt(late, new Date(T + 2 * 60_000), end)).toEqual(new Date(T + 2 * 60_000));
    // 할인 마감이 없는 강의는 지금 가격
    expect(heldPriceAt(issued, new Date(T + 60_000), null)).toEqual(new Date(T + 60_000));
  });
});
