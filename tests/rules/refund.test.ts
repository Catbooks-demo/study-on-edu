import { describe, expect, it } from "vitest";
import {
  FULL_REFUND_DAYS,
  FULL_REFUND_PROGRESS,
  type LectureUse,
  courseRefund,
  courseRefundMethods,
  refundProgress,
  subscriptionRefund,
} from "@/rules/refund";

const DAY = 86_400_000;
const PAID_AT = new Date("2026-11-02T03:00:00Z"); // KST 11월 2일 12:00

/** 10강 × 600초 = 6000초. 본 초 합을 앞 강부터 채운다. */
function lectures(watchedTotal: number, downloaded: number[] = []): LectureUse[] {
  let left = watchedTotal;
  return Array.from({ length: 10 }, (_, i) => {
    const w = Math.min(600, Math.max(0, left));
    left -= w;
    return { duration_sec: 600, watched_sec: w, downloaded: downloaded.includes(i) };
  });
}

const after = (days: number) => new Date(PAID_AT.getTime() + days * DAY);

function quote(o: { days: number; watched: number; access?: number | null; paid?: number; downloaded?: number[] }) {
  return courseRefund({
    paid: o.paid ?? 99_000,
    paid_at: PAID_AT,
    now: after(o.days),
    access_days: o.access === undefined ? 365 : o.access,
    lectures: lectures(o.watched, o.downloaded),
  });
}

describe("refundProgress", () => {
  it("caps watched at duration, downloads count as watched", () => {
    expect(refundProgress([{ duration_sec: 600, watched_sec: 900, downloaded: false }])).toBe(1);
    expect(refundProgress([{ duration_sec: 600, watched_sec: 0, downloaded: true }, { duration_sec: 600, watched_sec: 0, downloaded: false }])).toBe(0.5);
    expect(refundProgress([])).toBe(0);
  });

  it("constants", () => {
    expect(FULL_REFUND_DAYS).toBe(7);
    expect(FULL_REFUND_PROGRESS).toBe(0.05);
  });
});

describe("courseRefund", () => {
  it("full within 7 days", () => {
    const q = quote({ days: 3, watched: 240 });
    expect(q.kind).toBe("full");
    expect(q.elapsed_days).toBe(3);
    expect(q.refund).toBe(99_000);
  });

  it("5% exactly is prorated", () => {
    const q = quote({ days: 3, watched: 300 });
    expect(q.kind).toBe("prorated");
    expect(q.refund).toBe(94_050);
  });

  it("download breaks full", () => {
    const q = quote({ days: 0, watched: 0, downloaded: [0] });
    expect(q.kind).toBe("prorated");
    expect(q.progress_ratio).toBe(0.1);
    expect(q.refund).toBe(89_100);
  });

  it("period wins (bigger of progress and period)", () => {
    const q = quote({ days: 10, watched: 180 });
    expect(q.used_ratio).toBe(0.03);
    expect(q.refund).toBe(96_030);
    expect(q.basis_ko).toBe("결제 후 10일 · 진도 3.0% · 기간 2.7% → 큰 값 3.0% 공제 2,970원");
  });

  it("period larger", () => {
    const q = quote({ days: 8, watched: 0 });
    expect(q.used_amount).toBe(2169);
    expect(q.refund).toBe(96_831);
  });

  it("lifetime", () => {
    const q = quote({ days: 200, watched: 1200, access: null });
    expect(q.period_ratio).toBeNull();
    expect(q.refund).toBe(79_200);
  });

  it("completed → 0", () => {
    const q = quote({ days: 30, watched: 6000 });
    expect(q.refund).toBe(0);
    const over = courseRefund({
      paid: 99_000,
      paid_at: PAID_AT,
      now: after(30),
      access_days: 365,
      lectures: lectures(0).map((l) => ({ ...l, watched_sec: 5000 })),
    });
    expect(over.progress_ratio).toBe(1);
    expect(over.refund).toBe(0);
  });

  it("coupon basis (actual paid amount)", () => {
    const q = quote({ days: 10, watched: 600, paid: 62_100 });
    expect(q.refund).toBe(55_890);
  });

  it("KST boundary", () => {
    const paid_at = new Date("2026-11-01T14:59:59Z"); // KST 11월 1일 23:59:59
    const base = { paid: 99_000, paid_at, access_days: 365, lectures: lectures(0) };
    const last = courseRefund({ ...base, now: new Date("2026-11-08T14:59:59Z") });
    expect(last.elapsed_days).toBe(7);
    expect(last.kind).toBe("full");
    const next = courseRefund({ ...base, now: new Date("2026-11-08T15:00:00Z") });
    expect(next.elapsed_days).toBe(8);
    expect(next.kind).toBe("prorated");
  });

  it("methods side by side", () => {
    const m = courseRefundMethods({ paid: 99_000, paid_at: PAID_AT, now: after(10), access_days: 365, lectures: lectures(180) });
    expect(m).toEqual({ progress_based: 96_030, period_based: 96_288, applied: 96_030 });
    const lifetime = courseRefundMethods({ paid: 99_000, paid_at: PAID_AT, now: after(10), access_days: null, lectures: lectures(180) });
    expect(lifetime.period_based).toBeNull();
  });
});

describe("subscriptionRefund", () => {
  const start = PAID_AT;
  const end = new Date(start.getTime() + 30 * DAY);
  const sub = (days: number, watchedHours: number) =>
    subscriptionRefund({ paid: 29_000, paid_at: start, period_start: start, period_end: end, now: after(days), watched_sec: watchedHours * 3600, base_hours: 20 });

  it("subscription full", () => {
    const q = sub(2, 0);
    expect(q.kind).toBe("full");
    expect(q.refund).toBe(29_000);
  });

  it("subscription prorated", () => {
    const q = sub(10, 3);
    expect(q.kind).toBe("prorated");
    expect(q.used_amount).toBe(9666);
    expect(q.refund).toBe(19_334);
  });

  it("subscription watch wins", () => {
    const q = sub(2, 12);
    expect(q.kind).toBe("prorated");
    expect(q.refund).toBe(11_600);
  });
});
