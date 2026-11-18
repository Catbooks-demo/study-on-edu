import { describe, expect, it } from "vitest";
import { addDays, addMonthsClamped, diffDays, kstDate, kstMonth, kstMonthRange, prevMonth } from "@/rules/time";

describe("한국 시간", () => {
  it("kstDate·addDays·diffDays", () => {
    expect(kstDate(new Date("2026-11-18T15:00:00Z"))).toBe("2026-11-19");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-11-01", "2026-11-08")).toBe(7);
  });

  it("kstMonth boundary", () => {
    expect(kstMonth(new Date("2026-11-30T15:30:00Z"))).toBe("2026-12");
    expect(kstMonth(new Date("2026-11-30T14:59:59Z"))).toBe("2026-11");
  });

  it("kstMonthRange", () => {
    const r = kstMonthRange("2026-12");
    expect(r.start.toISOString()).toBe("2026-11-30T15:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-12-31T15:00:00.000Z");
  });

  it("addMonthsClamped", () => {
    expect(addMonthsClamped(new Date("2026-01-31T03:00:00Z"), 1).toISOString()).toBe("2026-02-28T03:00:00.000Z");
    expect(addMonthsClamped(new Date("2028-01-31T03:00:00Z"), 1).toISOString()).toBe("2028-02-29T03:00:00.000Z");
    expect(addMonthsClamped(new Date("2026-11-18T01:00:00Z"), 12).toISOString()).toBe("2027-11-18T01:00:00.000Z");
  });

  it("prevMonth", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
    expect(prevMonth("2026-12")).toBe("2026-11");
  });
});
