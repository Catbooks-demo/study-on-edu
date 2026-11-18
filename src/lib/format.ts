/** 화면 표기 (서버·브라우저 공용). */
export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const WD = ["일", "월", "화", "수", "목", "금", "토"];

/** 2026-12-01 → 12월 1일 (화) */
export function dateKo(date: string, withYear = false): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withYear ? `${y}년 ` : ""}${m}월 ${d}일 (${wd})`;
}

/** 2026-12-01 → 12.01(화) */
export function dateShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}(${wd})`;
}

/** ISO 시각 → 한국 시간 "11월 18일 14:05" */
export function dateTimeKo(iso: string): string {
  const t = new Date(iso);
  const p = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(t);
  const get = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${get("month")}월 ${get("day")}일 ${get("hour")}:${get("minute")}`;
}

/** 영상 길이: 754 → "12:34", 3725 → "1:02:05" */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 총 시간: 5400 → "1시간 30분", 600 → "10분" */
export function durationKo(sec: number): string {
  const total = Math.round(sec / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

/** 난이도 표기. */
export const LEVEL_LABEL: Record<string, string> = { beginner: "입문", intermediate: "중급", advanced: "고급" };

/** 수강 기간 표기: null → 평생, 365 → 1년, 90 → 90일 */
export function accessLabel(days: number | null): string {
  if (days === null) return "평생 소장";
  if (days % 365 === 0) return `${days / 365}년`;
  return `${days}일`;
}

/** 할인율 (정수 %, 내림): 99,000 → 69,000이면 30 */
export function discountPct(list: number, unit: number): number {
  return list > 0 ? Math.floor(((list - unit) * 100) / list) : 0;
}

/** 주문 상태 표기. */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "결제 대기",
  paid: "결제 완료",
  cancelled: "취소",
  partially_refunded: "부분 환불",
  refunded: "환불 완료",
};

/** 환불 상태 표기. */
export const REFUND_STATUS_LABEL: Record<string, string> = {
  requested: "환불 신청됨",
  approved: "환불 처리 중",
  rejected: "환불 거절",
  done: "환불 완료",
};

/** 수강권 출처 표기. */
export const ENROLLMENT_SOURCE_LABEL: Record<string, string> = { order: "구매", bundle: "패키지", subscription: "구독", free: "무료" };

/** 비율 → "3.0%" */
export const pct1 = (r: number) => `${(r * 100).toFixed(1)}%`;
