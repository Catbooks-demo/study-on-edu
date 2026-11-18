import { addMonthsClamped } from "./time";

/** 구독 청구 일정·일시정지 규칙 (순수 함수). */
export const RENEW_BEFORE_MS = 24 * 3600_000;
/** 첫 실패 시각 기준 재시도 날짜 (+1일, +3일, +5일). */
export const RETRY_DAYS = [1, 3, 5] as const;
/** 첫 시도 + 재시도 세 번 = 4번 실패하면 끝. */
export const MAX_FAILURES = 4;
export const PAUSE_MAX_DAYS = 30;
export const PAUSES_PER_YEAR = 2;

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;

export type Interval = "month" | "year";

/** 기간 끝: 시작 + 1달(또는 12달), 그달에 그 날이 없으면 말일. */
export function periodEnd(start: Date, interval: Interval): Date {
  return addMonthsClamped(start, interval === "year" ? 12 : 1);
}

/** 기간 끝 24시간 전부터 갱신 대상. */
export function renewalDue(period_end: Date, now: Date): boolean {
  return now.getTime() >= period_end.getTime() - RENEW_BEFORE_MS;
}

export type FailureNext = { status: "past_due"; next_retry_at: Date } | { status: "expired" };

/** n번째 실패 뒤 다음 상태. 1·2·3회 → first + RETRY_DAYS[n−1]일, 4회 이상 → expired. */
export function afterFailure(failure_count_after: number, first_failed_at: Date): FailureNext {
  if (failure_count_after >= MAX_FAILURES) return { status: "expired" };
  const n = Math.max(1, Math.floor(failure_count_after));
  return { status: "past_due", next_retry_at: new Date(first_failed_at.getTime() + RETRY_DAYS[n - 1] * DAY_MS) };
}

export type PauseCheck = { ok: true } | { ok: false; reason_ko: string };

/** 일시정지 가능한지: 1~30일, 최근 365일 안에 2번까지. */
export function canPause(pauses: { start: Date; days: number }[], days: number, now: Date): PauseCheck {
  if (!Number.isInteger(days) || days < 1 || days > PAUSE_MAX_DAYS) {
    return { ok: false, reason_ko: "일시정지는 1~30일 사이로 정해 주세요." };
  }
  const since = now.getTime() - YEAR_DAYS * DAY_MS;
  const recent = pauses.filter((p) => p.start.getTime() > since).length;
  if (recent >= PAUSES_PER_YEAR) return { ok: false, reason_ko: "일시정지는 1년에 2번까지 할 수 있어요." };
  return { ok: true };
}

/** 일찍 풀면 남은 온전한 날 수만큼 기간 끝을 당긴다. */
export function resumeEarly(period_end: Date, paused_until: Date, now: Date): Date {
  const left = Math.max(0, Math.floor((paused_until.getTime() - now.getTime()) / DAY_MS));
  return new Date(period_end.getTime() - left * DAY_MS);
}
