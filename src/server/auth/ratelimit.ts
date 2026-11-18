import { HttpError } from "../http";

/** 메모리 요청 제한 (앱 하나 기준). 창(windowSec) 안에서 limit번까지 허용. */
const hits = new Map<string, number[]>();

/**
 * 한 번 시도를 기록하고 허용 여부를 돌려준다.
 * 막혔을 때 retryAt은 창 안의 가장 오래된 시도가 창 밖으로 나가는 시각이다.
 */
export function rateLimit(key: string, limit: number, windowSec: number, now = Date.now()): { ok: boolean; retryAt: Date } {
  const windowMs = windowSec * 1000;
  const from = now - windowMs;
  const list = (hits.get(key) ?? []).filter((t) => t > from);
  if (list.length >= limit) {
    hits.set(key, list);
    return { ok: false, retryAt: new Date(list[0] + windowMs) };
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (!v.some((t) => t > from)) hits.delete(k);
  }
  return { ok: true, retryAt: new Date(now) };
}

/** 넘으면 429 RATE_LIMITED (응답에 Retry-After와 retry_at이 붙는다). */
export function enforceLimit(key: string, limit: number, windowSec: number, now = Date.now()): void {
  const r = rateLimit(key, limit, windowSec, now);
  if (r.ok) return;
  const e = new HttpError(429, "RATE_LIMITED", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
  e.retryAt = r.retryAt;
  e.retryAfterSec = Math.max(1, Math.ceil((r.retryAt.getTime() - now) / 1000));
  throw e;
}

export function resetRateLimits(): void {
  hits.clear();
}

/** [횟수, 창(초)] */
export const LIMITS = {
  login: { ipEmail: [10, 600], ip: [30, 600] },
  signup: [5, 600],
  checkout: { user: [20, 60], ip: [60, 60] },
  write: [10, 600],
  chat: [30, 60],
  api: [600, 60],
} as const satisfies Record<string, readonly [number, number] | Record<string, readonly [number, number]>>;

/** 로그인 공통 (회원·직원·강사가 key 접두사만 다르다): IP+이메일 10회/10분, IP 30회/10분. */
export function enforceLoginLimit(prefix: string, ip: string, email: string, now = Date.now()): void {
  enforceLimit(`${prefix}:ip:${ip}`, ...LIMITS.login.ip, now);
  enforceLimit(`${prefix}:ip-email:${ip}:${email}`, ...LIMITS.login.ipEmail, now);
}
