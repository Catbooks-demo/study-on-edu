import { won } from "@/lib/format";
import { diffDays, kstDate } from "./time";

/**
 * 환불 규칙 (spec "규칙 › 환불"). DB를 모르는 순수 함수.
 * 비율은 분자·분모 정수로 들고 공제액은 Math.floor(paid × num ÷ den)로 내린다(수강생에게 유리하게, 부동소수 오차 없이).
 * 큰 값 고르기도 교차 곱으로 한다.
 */
export const FULL_REFUND_DAYS = 7;
export const FULL_REFUND_PROGRESS = 0.05;
/** FULL_REFUND_PROGRESS를 분수로 (5 ÷ 100). */
const FULL_PROGRESS_FRAC = { num: 5, den: 100 };

export type LectureUse = { duration_sec: number; watched_sec: number; downloaded: boolean };

export type RefundQuote = {
  kind: "full" | "prorated";
  elapsed_days: number;
  progress_ratio: number;
  period_ratio: number | null;
  used_ratio: number;
  used_amount: number;
  refund: number;
  basis_ko: string;
};

type Frac = { num: number; den: number };

const ZERO: Frac = { num: 0, den: 1 };
const ONE: Frac = { num: 1, den: 1 };
const frac = (num: number, den: number): Frac => (den > 0 ? { num: Math.max(0, num), den } : ZERO);
const ge = (a: Frac, b: Frac) => a.num * b.den >= b.num * a.den;
const max = (a: Frac, b: Frac) => (ge(a, b) ? a : b);
const min1 = (a: Frac) => (ge(a, ONE) ? ONE : a);
const val = (a: Frac) => a.num / a.den;
const of = (paid: number, a: Frac) => Math.floor((paid * a.num) / a.den);
const pct = (a: Frac) => `${((a.num * 100) / a.den).toFixed(1)}%`;

/** Σ min(길이, 자료 받음 ? 길이 : 본 초) ÷ Σ 길이 (분수). */
function progressFrac(lectures: LectureUse[]): Frac {
  let num = 0;
  let den = 0;
  for (const l of lectures) {
    const d = Math.max(0, l.duration_sec);
    num += l.downloaded ? d : Math.min(d, Math.max(0, l.watched_sec));
    den += d;
  }
  return den > 0 ? { num, den } : ZERO;
}

/** 환불 진도율: Σ min(d, downloaded ? d : watched) ÷ Σ d (Σd=0이면 0). */
export function refundProgress(lectures: LectureUse[]): number {
  return val(progressFrac(lectures));
}

export type CourseRefundInput = { paid: number; paid_at: Date; now: Date; access_days: number | null; lectures: LectureUse[] };

function courseParts(i: CourseRefundInput) {
  const elapsed = Math.max(0, diffDays(kstDate(i.paid_at), kstDate(i.now)));
  const progress = progressFrac(i.lectures);
  const period = i.access_days ? min1(frac(elapsed, i.access_days)) : null;
  const downloaded = i.lectures.some((l) => l.downloaded);
  return { elapsed, progress, period, downloaded };
}

/** 단건·패키지 환불 계산. paid는 쿠폰 뒤 실제 낸 금액. */
export function courseRefund(i: CourseRefundInput): RefundQuote {
  const { elapsed, progress, period, downloaded } = courseParts(i);
  const progress_ratio = Math.min(1, val(progress));
  const period_ratio = period ? val(period) : null;
  const full = elapsed <= FULL_REFUND_DAYS && !ge(progress, FULL_PROGRESS_FRAC) && !downloaded;
  if (full) {
    return {
      kind: "full",
      elapsed_days: elapsed,
      progress_ratio,
      period_ratio,
      used_ratio: 0,
      used_amount: 0,
      refund: i.paid,
      basis_ko: `결제 후 ${elapsed}일 · 진도 ${pct(progress)} → 7일 이내·진도 5% 미만이라 전액 환불`,
    };
  }
  const used = min1(period ? max(progress, period) : progress);
  const used_amount = Math.min(i.paid, of(i.paid, used));
  const refund = Math.max(0, i.paid - used_amount);
  const parts = [`결제 후 ${elapsed}일`, `진도 ${pct(progress)}`];
  if (period) parts.push(`기간 ${pct(period)}`);
  const pick = period ? `큰 값 ${pct(used)} 공제` : `${pct(used)} 공제`;
  return {
    kind: "prorated",
    elapsed_days: elapsed,
    progress_ratio,
    period_ratio,
    used_ratio: val(used),
    used_amount,
    refund,
    basis_ko: `${parts.join(" · ")} → ${pick} ${won(used_amount)}${downloaded ? " (자료를 받은 강은 본 것으로 계산)" : ""}`,
  };
}

/** 직원 계산기용: 진도 기준·기간 기준 환불액을 나란히. applied는 실제 적용(둘 중 작은 환불액). 전액 조건이면 applied = paid. */
export function courseRefundMethods(i: CourseRefundInput): { progress_based: number; period_based: number | null; applied: number } {
  const { progress, period } = courseParts(i);
  const progress_based = Math.max(0, i.paid - of(i.paid, min1(progress)));
  const period_based = period ? Math.max(0, i.paid - of(i.paid, period)) : null;
  return { progress_based, period_based, applied: courseRefund(i).refund };
}

export type SubscriptionRefundInput = {
  paid: number;
  paid_at: Date;
  period_start: Date;
  period_end: Date;
  now: Date;
  watched_sec: number;
  base_hours: number;
};

/** 구독 환불: 7일 이내 미시청 전액, 그 밖에는 max(경과일 ÷ 기간 일수, 시청 ÷ 기준 시간) 공제. */
export function subscriptionRefund(i: SubscriptionRefundInput): RefundQuote {
  const elapsedPaid = Math.max(0, diffDays(kstDate(i.paid_at), kstDate(i.now)));
  const watched = Math.max(0, i.watched_sec);
  const watchFrac = min1(frac(watched, Math.max(0, i.base_hours) * 3600));
  if (elapsedPaid <= FULL_REFUND_DAYS && watched === 0) {
    return {
      kind: "full",
      elapsed_days: elapsedPaid,
      progress_ratio: 0,
      period_ratio: null,
      used_ratio: 0,
      used_amount: 0,
      refund: i.paid,
      basis_ko: `결제 후 ${elapsedPaid}일 · 시청 없음 → 7일 이내 미시청이라 전액 환불`,
    };
  }
  const periodDays = Math.max(1, diffDays(kstDate(i.period_start), kstDate(i.period_end)));
  const elapsed = Math.max(0, diffDays(kstDate(i.period_start), kstDate(i.now)));
  const period = min1(frac(elapsed, periodDays));
  const used = min1(max(period, watchFrac));
  const used_amount = Math.min(i.paid, of(i.paid, used));
  return {
    kind: "prorated",
    elapsed_days: elapsedPaid,
    progress_ratio: val(watchFrac),
    period_ratio: val(period),
    used_ratio: val(used),
    used_amount,
    refund: Math.max(0, i.paid - used_amount),
    basis_ko: `결제 후 ${elapsedPaid}일 · 기간 ${pct(period)} · 시청 ${pct(watchFrac)} → 큰 값 ${pct(used)} 공제 ${won(used_amount)}`,
  };
}
