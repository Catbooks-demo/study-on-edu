import { describe, expect, it } from "vitest";
import {
  MAX_FAILURES,
  PAUSES_PER_YEAR,
  PAUSE_MAX_DAYS,
  RENEW_BEFORE_MS,
  RETRY_DAYS,
  afterFailure,
  canPause,
  periodEnd,
  renewalDue,
  resumeEarly,
} from "@/rules/billing";

const DAY = 86_400_000;

describe("구독 청구 일정", () => {
  it("constants", () => {
    expect(RENEW_BEFORE_MS).toBe(24 * 3600_000);
    expect(RETRY_DAYS).toEqual([1, 3, 5]);
    expect(MAX_FAILURES).toBe(4);
    expect(PAUSE_MAX_DAYS).toBe(30);
    expect(PAUSES_PER_YEAR).toBe(2);
  });

  it("month end clamp", () => {
    expect(periodEnd(new Date("2026-01-31T03:00:00Z"), "month").toISOString()).toBe("2026-02-28T03:00:00.000Z");
  });

  it("year", () => {
    expect(periodEnd(new Date("2028-02-29T00:00:00Z"), "year").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });

  it("plain month", () => {
    expect(periodEnd(new Date("2026-11-18T05:00:00Z"), "month").toISOString()).toBe("2026-12-18T05:00:00.000Z");
  });

  it("renewalDue", () => {
    const end = new Date("2026-12-18T05:00:00Z");
    expect(renewalDue(end, new Date(end.getTime() - 24 * 3600_000 - 1))).toBe(false);
    expect(renewalDue(end, new Date(end.getTime() - 24 * 3600_000))).toBe(true);
    expect(renewalDue(end, new Date(end.getTime() + DAY))).toBe(true);
  });

  it("failure schedule", () => {
    const first = new Date("2026-12-01T00:00:00Z");
    expect(afterFailure(1, first)).toEqual({ status: "past_due", next_retry_at: new Date("2026-12-02T00:00:00Z") });
    expect(afterFailure(2, first)).toEqual({ status: "past_due", next_retry_at: new Date("2026-12-04T00:00:00Z") });
    expect(afterFailure(3, first)).toEqual({ status: "past_due", next_retry_at: new Date("2026-12-06T00:00:00Z") });
    expect(afterFailure(4, first)).toEqual({ status: "expired" });
    expect(afterFailure(5, first)).toEqual({ status: "expired" });
  });
});

describe("일시정지", () => {
  const now = new Date("2026-11-18T03:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  it("pause limits: days 1..30", () => {
    expect(canPause([], 30, now)).toEqual({ ok: true });
    expect(canPause([], 1, now)).toEqual({ ok: true });
    expect(canPause([], 31, now)).toEqual({ ok: false, reason_ko: "일시정지는 1~30일 사이로 정해 주세요." });
    expect(canPause([], 0, now)).toEqual({ ok: false, reason_ko: "일시정지는 1~30일 사이로 정해 주세요." });
    expect(canPause([], 1.5, now)).toEqual({ ok: false, reason_ko: "일시정지는 1~30일 사이로 정해 주세요." });
  });

  it("pause limits: 2 per 365 days", () => {
    const two = [
      { start: ago(200), days: 10 },
      { start: ago(30), days: 5 },
    ];
    expect(canPause(two, 5, now)).toEqual({ ok: false, reason_ko: "일시정지는 1년에 2번까지 할 수 있어요." });
    const oldAndRecent = [
      { start: ago(366), days: 10 },
      { start: ago(30), days: 5 },
    ];
    expect(canPause(oldAndRecent, 5, now)).toEqual({ ok: true });
  });

  it("resume early: 10-day pause released after 3 days pulls end 7 days", () => {
    const start = new Date("2026-11-01T00:00:00Z");
    const pausedUntil = new Date(start.getTime() + 10 * DAY);
    const periodEndAfterPause = new Date("2026-12-11T00:00:00Z");
    const now3 = new Date(start.getTime() + 3 * DAY);
    expect(resumeEarly(periodEndAfterPause, pausedUntil, now3).toISOString()).toBe("2026-12-04T00:00:00.000Z");
    // 온전한 날만 당긴다: 3일 + 1시간이면 남은 6일 23시간 → 6일
    const now3h = new Date(start.getTime() + 3 * DAY + 3600_000);
    expect(resumeEarly(periodEndAfterPause, pausedUntil, now3h).toISOString()).toBe("2026-12-05T00:00:00.000Z");
    // 이미 지났으면 그대로
    expect(resumeEarly(periodEndAfterPause, pausedUntil, new Date(pausedUntil.getTime() + 1)).toISOString()).toBe(
      "2026-12-11T00:00:00.000Z",
    );
  });
});
