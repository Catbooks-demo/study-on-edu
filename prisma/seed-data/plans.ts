/** 구독 플랜 2개. refund_base_hours = 구독 환불 "기준 시간". */
export const PLANS = [
  { code: "monthly", name: "월 구독", interval: "month", price: 29_000, refund_base_hours: 20 },
  { code: "yearly", name: "연 구독", interval: "year", price: 290_000, refund_base_hours: 240 },
] as const;
