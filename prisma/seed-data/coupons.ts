import { REFERRAL_SLUGS } from "./instructors";

/** 쿠폰. 기간은 seed-lib가 시드 시각 기준으로 정한다(validDays). 구독에는 쓰지 않는다. */
export interface SeedCoupon {
  code: string;
  name: string;
  kind: "fixed" | "percent";
  value: number;
  max_discount?: number;
  min_amount?: number;
  target?: "all" | "category" | "course" | "instructor";
  target_ref?: string;
  per_user_once?: boolean;
  referral?: boolean;
  instructorSlug?: string;
  validDays: number;
}

export const COUPONS: SeedCoupon[] = [
  { code: "WELCOME10", name: "첫 수강 10% 할인", kind: "percent", value: 10, max_discount: 10_000, per_user_once: true, validDays: 365 },
  { code: "D30SALE", name: "자격증 D-30 5,000원 할인", kind: "fixed", value: 5_000, target: "category", target_ref: "CERT", validDays: 30 },
  { code: "ALLPASS20", name: "10만 원 이상 20% 할인", kind: "percent", value: 20, min_amount: 100_000, validDays: 60 },
  ...REFERRAL_SLUGS.map(
    (slug): SeedCoupon => ({
      code: `REF-${slug}`,
      name: "강사 추천 코드 10% 할인",
      kind: "percent",
      value: 10,
      target: "instructor",
      target_ref: slug,
      referral: true,
      instructorSlug: slug,
      validDays: 365,
    }),
  ),
];
