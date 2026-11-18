import { describe, expect, it } from "vitest";
import { QUESTION_DUE_DAYS, REFUND_PROCESS_DAYS, questionOverdue, refundDueAt, refundOverdue } from "@/rules/deadlines";

describe("질문 답변 기한", () => {
  const created = new Date("2026-11-01T00:00:00Z");

  it("7 days exactly is not overdue, one second more is", () => {
    expect(QUESTION_DUE_DAYS).toBe(7);
    expect(questionOverdue(created, null, new Date("2026-11-08T00:00:00Z"))).toBe(false);
    expect(questionOverdue(created, null, new Date("2026-11-08T00:00:01Z"))).toBe(true);
  });

  it("answered is never overdue", () => {
    expect(questionOverdue(created, new Date("2026-11-09T00:00:00Z"), new Date("2026-11-20T00:00:00Z"))).toBe(false);
  });
});

describe("환불 처리 기한", () => {
  const approved = new Date("2026-11-10T05:00:00Z");

  it("refundDueAt = approved + 5 days", () => {
    expect(REFUND_PROCESS_DAYS).toBe(5);
    expect(refundDueAt(approved).toISOString()).toBe("2026-11-15T05:00:00.000Z");
  });

  it("refundOverdue", () => {
    expect(refundOverdue(approved, null, new Date("2026-11-15T05:00:00Z"))).toBe(false);
    expect(refundOverdue(approved, null, new Date("2026-11-15T05:00:01Z"))).toBe(true);
    expect(refundOverdue(approved, new Date("2026-11-12T00:00:00Z"), new Date("2026-11-20T00:00:00Z"))).toBe(false);
  });
});
