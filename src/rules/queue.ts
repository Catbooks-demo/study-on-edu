/** 대기열 규칙 (순수 함수). */

/** 입장 허용 시간(초)과 새로고침 없는 대기표 만료(초). */
export const ADMIT_TTL_SEC = 600;
export const STALE_SEC = 60;

/** 결제 캠페인: 할인 마감 전에 받은 순번표는 마감 뒤 이만큼까지 발급 시각 가격을 쓴다. */
export const HOLD_AFTER_SALE_MS = 30 * 60_000;

/**
 * 이번에 들여보낼 수. 마지막 입장 시각부터 흐른 시간 × 초당 한도 (오래 쉬었어도 burst초 몫까지만).
 * 기다리는 사람이 남으면 쓴 몫만큼만 시계를 앞으로(소수 몫 보존), 다 들였으면 지금으로.
 */
export function admitCount(last: number, now: number, rate: number, waiting: number, burstSec = 10) {
  const from = Math.max(last, now - burstSec * 1000);
  const n = Math.max(0, Math.min(waiting, Math.floor(((now - from) / 1000) * rate)));
  const next = waiting > n ? from + (n / rate) * 1000 : now;
  return { n, next_last_admit_at_ms: next };
}

/** 앞사람 수로 본 예상 대기 시간(초). */
export function etaSeconds(ahead: number, rate: number): number {
  return Math.ceil(ahead / Math.max(1, rate));
}

/**
 * 순번표 발급 시각 가격을 쓸지: 할인 마감 전에 받은 표이고 지금이 마감 + 30분 안이면 발급 시각, 아니면 지금.
 */
export function heldPriceAt(issuedAt: Date, now: Date, saleEndsAt: Date | null): Date {
  if (!saleEndsAt) return now;
  const end = saleEndsAt.getTime();
  if (issuedAt.getTime() < end && now.getTime() <= end + HOLD_AFTER_SALE_MS) return issuedAt;
  return now;
}
