/**
 * 강사 정산 규칙 (spec "규칙 › 강사 정산", 계획 "이 계획이 정한 것 › 정산"). DB를 모르는 순수 함수.
 * 비율은 정수 분수로 바꿔 Math.floor(금액 × 분자 ÷ 분모)로 계산한다(0.7 × 29 같은 부동소수 오차 없이).
 */
export const SALE_RATE = 0.7;
export const REFERRAL_RATE = 0.9;
export const SUBSCRIPTION_SHARE = 0.5;
/** 지급 예정일: 다음 달 10일. */
export const PAY_DAY = 10;

/** 0.7 → 70/100. 정산 비율은 소수 둘째 자리까지만 쓴다. */
function share(amount: number, rate: number): number {
  const num = Math.round(rate * 100);
  return Math.floor((amount * num) / 100);
}

export type SettleInput = {
  sales: { amount: number; referral: boolean }[];
  /** 환불액과 그 판매에 원래 적용한 비율 (0.7·0.9). */
  refunds: { amount: number; rate: number }[];
  /** 그달 구독 풀 (구독 결제 − 구독 환불). */
  pool: number;
  instructor_sec: number;
  total_sec: number;
  /** 앞달에서 넘어온 음수 (≤ 0). */
  carried_in: number;
};

export type SettleResult = {
  sales_amount: number;
  sales_share: number;
  referral_amount: number;
  referral_share: number;
  subscription_share: number;
  refund_deduction: number;
  carried_in: number;
  total: number;
  payout: number;
  carry_out: number;
};

/** 판매 줄마다 floor(금액 × 비율)를 해서 더한다. */
export const saleShare = (amount: number, referral: boolean) => share(amount, referral ? REFERRAL_RATE : SALE_RATE);

/** 환불 차감 한 줄: floor(환불액 × 원래 비율). */
export const refundShare = (amount: number, rate: number) => share(amount, rate);

/** 구독 몫 = floor(풀 × 0.5 × 강사 시청 초 ÷ 전체 시청 초). 전체가 0이면 0. */
export function subscriptionShare(pool: number, instructorSec: number, totalSec: number): number {
  if (!totalSec || pool <= 0 || instructorSec <= 0) return 0;
  // 큰 수 곱셈도 정확하게 BigInt로
  const half = BigInt(Math.round(SUBSCRIPTION_SHARE * 100));
  return Number((BigInt(pool) * half * BigInt(instructorSec)) / (100n * BigInt(totalSec)));
}

export function settle(i: SettleInput): SettleResult {
  let sales_amount = 0;
  let sales_share = 0;
  let referral_amount = 0;
  let referral_share = 0;
  for (const s of i.sales) {
    if (s.referral) {
      referral_amount += s.amount;
      referral_share += saleShare(s.amount, true);
    } else {
      sales_amount += s.amount;
      sales_share += saleShare(s.amount, false);
    }
  }
  const subscription_share = subscriptionShare(i.pool, i.instructor_sec, i.total_sec);
  const refund_deduction = i.refunds.reduce((a, r) => a + refundShare(r.amount, r.rate), 0);
  const carried_in = Math.min(0, i.carried_in);
  const total = sales_share + referral_share + subscription_share - refund_deduction + carried_in;
  return {
    sales_amount,
    sales_share,
    referral_amount,
    referral_share,
    subscription_share,
    refund_deduction,
    carried_in,
    total,
    payout: Math.max(0, total),
    carry_out: Math.min(0, total),
  };
}

/** 그달(YYYY-MM) 정산의 지급 예정일: 다음 달 10일 (YYYY-MM-DD). */
export function payDate(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, PAY_DAY));
  return next.toISOString().slice(0, 10);
}
