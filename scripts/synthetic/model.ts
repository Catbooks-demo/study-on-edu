/**
 * 스터디온에듀 가상 이용자 모형 (DB를 건드리지 않는 순수한 부분).
 *
 * 설계: "스터디온에듀 가상 이용자 설계" 문서(2026-11-18). 숫자는 그 문서의 표·스크립트 배열
 * (per·age·cat·dev·hrs·ev·asm, 이탈 곡선, 시험 배수) 그대로다. 하루 결제량을 위에서 나눠 주지 않는다:
 * 회원마다 1년에 몇 번 결제하는지가 정해지고, 그날의 요일·시험 달력·할인 기간 효과를 곱한 회원별 기대값을
 * 모두 더한 것이 그날 결제량이다.
 *
 * 같은 시드·같은 날이면 계획이 같다(되채우기와 매일 모드가 같은 날을 같은 모양으로 본다).
 */
import { BUNDLES } from "../../prisma/seed-data/bundles";
import { COURSES } from "../../prisma/seed-data/courses";
import { LIVE } from "../../prisma/seed-data/live";
import { courseCodes, planCurriculum } from "../../prisma/seed-lib";
import { addDays, diffDays, kstDate, kstDateTime, weekday } from "../../src/rules/time";
import { givenPool, SURNAMES } from "./names";
import { bisect, cumulative, Rng } from "./rng";

// ── 표시 ──
/** 가상 데이터 표시: 가상 회원·가상 직원의 이메일은 모두 이 도메인이다 (.test는 실제로 쓰이지 않는 도메인). */
export const SYNTH_DOMAIN = "synth.studyon.test";
export const SYNTH_STAFF_EMAIL = `ops@${SYNTH_DOMAIN}`;
/** 가상 쿠폰 번호 앞머리 (할인·보상 쿠폰). */
export const SYNTH_COUPON_PREFIX = "SYNTH-";
/** 가상 회원 기기 키 앞머리 (so_device 쿠키 자리). */
export const SYNTH_DEVICE_PREFIX = "synth-";
export const isSynthEmail = (email: string) => email.toLowerCase().endsWith(`@${SYNTH_DOMAIN}`);

// ── 크기 (설계 2절) ──
export const DEFAULT_SEED = 20261118;
/** 학습자가 결제하거나 강의를 본 날 기준: 오늘 − 60일 ~ 오늘 (한국 날짜, 양 끝 포함 61일). */
export const WINDOW_DAYS = 60;
export const MEMBERS = 30_000;
export const NEW_MEMBERS = 3_000; // 기간 안에 가입
export const JITTER = 0.3; // 회원마다 ±30%
/** 평상시 하루 결제(단과·패키지·구독 신규). 설계: 회원 3만 × 연 12만 원 ÷ 건당 7.6만 원 ÷ 365 ≈ 130건. */
export const ORDERS_PER_DAY = 130;
/** 회원 1명 평균 연 지출(만 원). 유형별 연 지출은 이 평균에 맞춰 같은 비율로 줄인다. */
export const SPEND_MEAN = 12;

// ── 분야 (설계 3절 cat, 결제 금액 비중 %) ──
export const CATEGORY_CODES = ["DEV", "DATA", "CERT", "LANG", "DSGN", "BIZ", "EXAM"] as const;
export type Cat = (typeof CATEGORY_CODES)[number];
export const CATEGORY_KO: Record<Cat, string> = {
  DEV: "개발·프로그래밍",
  DATA: "데이터·AI",
  CERT: "자격증",
  LANG: "어학",
  DSGN: "디자인",
  BIZ: "비즈니스·마케팅",
  EXAM: "수능·내신",
};
export const CATEGORY_SHARE: Record<Cat, number> = { DEV: 19, EXAM: 18, CERT: 16, LANG: 15, DATA: 12, BIZ: 11, DSGN: 9 };

// ── 연령 (설계 3절 age, 회원 %) ── 정답지에서 결과와 견준다.
export const AGE_SHARE: readonly [string, number][] = [
  ["10대", 24],
  ["20대", 31],
  ["30대", 21],
  ["40대", 17],
  ["50대 이상", 3],
  ["비움", 4],
];

// ── 기기 (설계 3절 dev) ──
export const DEVICE_TYPES = ["pc", "laptop", "tablet", "phone", "tv"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];
export const DEVICE_KO: Record<DeviceType, string> = { pc: "PC", laptop: "노트북", tablet: "태블릿", phone: "스마트폰", tv: "TV" };
export const DEVICE_SHARE = [34, 25, 20, 20, 1] as const;
/** 연령대별 기울기 (10대 태블릿 52.7%, 50~60대 스마트폰 37~46%). 전체 비중에 맞춰 다시 나눈다. */
const DEVICE_TILT: Record<"teen" | "adult" | "senior", number[]> = {
  teen: [18, 12, 52.7, 16, 1.3],
  adult: [34, 27, 15, 23, 1],
  senior: [26, 12, 16, 42, 4],
};
/** 기기 2대인 회원 몫 (계정당 2대 제한). */
export const TWO_DEVICE_SHARE = 0.45;
/** 기기 종류별 User-Agent (서버의 deviceName이 "Windows · Chrome"처럼 이름을 만든다). */
export const DEVICE_UA: Record<DeviceType, readonly string[]> = {
  pc: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  ],
  laptop: [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Whale/3.28 Safari/537.36",
  ],
  tablet: [
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; SM-X910N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  ],
  phone: [
    "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ],
  tv: ["Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/5.0 Chrome/94.0.4606.31 TV Safari/537.36"],
};

// ── 시간대 (설계 3절 hrs: 연령대별 봉우리) ──
export const HRS = {
  teen: [1, 0.6, 0.3, 0.2, 0.1, 0.1, 0.2, 0.5, 0.6, 0.5, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.5, 1.8, 2, 2.4, 3.2, 4.6, 3.6],
  twenties: [2.6, 1.6, 0.9, 0.5, 0.3, 0.2, 0.3, 0.6, 1, 1.4, 1.8, 2, 2, 2.1, 2.2, 2.3, 2.5, 2.8, 3.4, 4.2, 5, 5, 4.6, 3.6],
  thirties: [3.4, 1.8, 0.8, 0.4, 0.2, 0.3, 0.8, 1.6, 1.4, 1.2, 1.2, 1.6, 2, 1.6, 1.4, 1.4, 1.4, 1.6, 2, 2.6, 3.4, 4.2, 5, 5],
  senior: [0.4, 0.2, 0.1, 0.1, 0.2, 0.6, 1.6, 3, 4.4, 5, 5, 4.6, 3.4, 2.8, 2.6, 2.4, 2.2, 2, 2, 2, 1.8, 1.6, 1, 0.6],
} as const;
export type HourProfile = keyof typeof HRS | "mixed";

// ── 요일 (설계 스크립트 dowIdx, 0=일 … 6=토): 평일 저녁 위주, 일요일 밤 높음, 금·토 낮음 ──
export const DOW_INDEX = [1.1, 1.08, 1.05, 1.0, 1.0, 0.85, 0.92] as const;
export const dowIndex = (date: string) => DOW_INDEX[weekday(date)];

// ── 결제 구성 (설계 4절·asm, 건수 %) ──
export const PRODUCT_KINDS = ["single", "bundle", "monthly", "yearly"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const PRODUCT_MIX = [72, 8, 16, 4] as const;
export const PRODUCT_KO: Record<ProductKind, string> = { single: "단과", bundle: "패키지", monthly: "월 구독", yearly: "연 구독" };

// ── 할인 (설계 asm "할인": 결제의 55%가 할인가, 평균 25%) ──
export const DISCOUNT = { share: 0.55, depth: 0.25, saleWeekShare: 0.75 } as const;
/** 가상 할인 쿠폰 (정률, 대상 전체). 평균 25%. */
export const SALE_COUPONS: readonly [code: string, pct: number, weight: number][] = [
  ["SYNTH-SALE20", 20, 0.3],
  ["SYNTH-SALE25", 25, 0.4],
  ["SYNTH-SALE30", 30, 0.3],
];

// ── 결제 뒤의 일 (설계 5절·asm) ──
export const REFUND_RATE: Record<ProductKind, number> = { single: 0.04, bundle: 0.06, monthly: 0.015, yearly: 0.05 };
/** 환불이 몰리는 분야 (소비자원: 외국어 32.5%, 직무·취업 24.0%). 분야 비중으로 평균 1이 되게 나눈다. */
const REFUND_SKEW_RAW: Record<Cat, number> = { LANG: 1.8, BIZ: 1.5, DATA: 1.2, DEV: 1.0, DSGN: 0.9, CERT: 0.6, EXAM: 0.5 };
export const REFUND_SKEW: Record<Cat, number> = (() => {
  const mean = CATEGORY_CODES.reduce((s, c) => s + REFUND_SKEW_RAW[c] * CATEGORY_SHARE[c], 0) / 100;
  return Object.fromEntries(CATEGORY_CODES.map((c) => [c, REFUND_SKEW_RAW[c] / mean])) as Record<Cat, number>;
})();
export const RATES = {
  refundEarly: 0.75, // 환불 중 7일 안·진도 5% 미만 전액 환불 몫
  refundReject: 0.03, // 직원이 거절하는 몫 (판단)
  question: 0.05, // 유료 수강자의 질문
  questionDevData: 0.08, // 개발·데이터
  review: 0.06, // 수강자의 후기 (결과 목표)
  reviewCompleted: 0.25, // 완강자의 후기
  reviewAt40: 0.05, // 진도 40%를 넘긴 수강자의 후기 (완강 전)
  inquiry: 0.03, // 결제의 1:1 문의
  answerInstructor: 0.85, // 질문에 강사가 답함
  answerStaff: 0.07, // 운영팀(가상 직원)이 답함 (나머지는 7일 넘게 답 없음)
  certificate: 0.9, // 완강자가 수료증을 받음
};
export const SUBS = {
  monthlyChurn: 0.1,
  yearlyRenew: 0.4,
  payFail: 0.04,
  payRecover: 0.5,
  pause: 0.03, // 기간마다 일시정지하는 몫 (판단)
  yearlyShare: 0.4, // 연:월 신규 40:60 (PRODUCT_MIX 16:4와 별개로 설계 5절에 적힌 값, 결과 비교용)
};
/** 시연용 실패 카드 (끝 4자리 4000이면 늘 거절). */
export const FAIL_CARD = "4000";

// ── 진도와 이탈 곡선 (설계 5절) ──
export const DROP = { first: 0.78, second: 0.56, third: 0.44 } as const;
/** 마지막 강까지 가는 비율 (자격증·수능 25~35%, 취미·디자인 10% 안팎, 분야 평균 약 17%). */
export const FINAL_BY_CAT: Record<Cat, number> = { CERT: 0.3, EXAM: 0.3, DSGN: 0.1, DEV: 0.11, LANG: 0.12, DATA: 0.1, BIZ: 0.09 };
export const FINAL_MEAN_TARGET = 0.17;
/** 구독 수강권은 여러 강의를 조금씩: 마지막 강 비율 × 0.5. */
export const SUB_FINAL_FACTOR = 0.5;
/** 한 번 볼 때 25~40분. */
export const SESSION_MIN = [25, 40] as const;
export const RATE_CHOICES: readonly [rate: number, weight: number][] = [
  [1, 0.7],
  [1.25, 0.12],
  [1.5, 0.1],
  [2, 0.05],
  [0.75, 0.03],
];

/**
 * k번째 강(1부터)을 여는 수강생 비율. 1강 78%, 2강 56%, 3강 44%(1~3강에서 가파르게),
 * 그 뒤로는 마지막 강(final)까지 곧게 줄어든다. scale은 곡선 전체 배수(패키지 뒤쪽 강의 등).
 */
export function reachProb(k: number, n: number, final: number, scale = 1): number {
  if (k < 1 || k > n) return 0;
  const f = Math.min(DROP.third, Math.max(0, final));
  let p: number;
  if (k === 1) p = DROP.first;
  else if (k === 2) p = DROP.second;
  else if (k === 3) p = DROP.third;
  else p = DROP.third + ((f - DROP.third) * (k - 3)) / (n - 3);
  if (k === n && n > 1) p = Math.min(p, f);
  return p * scale;
}

/** 몇 강까지 여는지 (0 = 1강도 안 엶): 곡선 아래로 한 번 뽑는다. */
export function sampleReach(u: number, n: number, final: number, scale = 1): number {
  let r = 0;
  for (let k = 1; k <= n; k++) if (reachProb(k, n, final, scale) > u) r = k;
  return r;
}

// ── 시험 달력 (설계 6절 ev, 스크립트 certM·csatM) ──
export const EXAMS = {
  jeongcheogi: { start: "2026-10-24", end: "2026-11-13", peak: 0.9 },
  realtor: { date: "2026-10-31", peak: 1.1 },
  toeic: ["2026-11-15", "2026-11-29", "2026-12-13", "2026-12-27"],
  csat: "2026-11-19",
} as const;
export const CHUSEOK: readonly [string, string][] = [
  ["2026-09-24", "2026-09-27"],
  ["2027-09-14", "2027-09-17"],
];
export const CHUSEOK_FACTOR = 0.85;
/** 수능 다음 날부터 (판단: 2월 말까지): 수능·내신 ×0.4, 자격증·어학·개발 ×1.25. */
export const POST_CSAT = { from: "2026-11-20", to: "2027-02-28", exam: 0.4, shift: 1.25 } as const;
/** 11월 말 할인 기간 (판단: 블랙프라이데이 주간 11/23~11/30): 결제 ×1.3, 할인가 결제 75%. */
export const LATE_NOV_SALE = { from: "2026-11-23", to: "2026-11-30", factor: 1.3 } as const;
/** 1월 새해 수요 (판단): 결제 ×1.2, 어학·자격증은 ×1.3. */
export const NEW_YEAR = { from: "2027-01-01", to: "2027-01-31", factor: 1.2, langCert: 1.3 } as const;

/** 시험 파도: 시험 D-30부터 1 → 1+peak로 오르고, 시험 뒤 6일은 0.6(급락), 그 뒤 평소. */
export function examWave(date: string, exam: string, peak: number): number {
  const d = diffDays(date, exam);
  if (d >= 0 && d <= 30) return 1 + peak * (1 - d / 30);
  if (d < 0 && d > -7) return 0.6;
  return 1;
}
/** 자격증 분야 전체 배수 (설계 certM): 공인중개사 10/31과 정보처리기사 실기 끝 11/13의 반반. */
export const certMultiplier = (date: string) =>
  0.5 * examWave(date, EXAMS.realtor.date, EXAMS.realtor.peak) + 0.5 * examWave(date, EXAMS.jeongcheogi.end, EXAMS.jeongcheogi.peak);
/** 수능·내신 (설계 csatM): 수능 D-30부터 서서히 1.5배. */
export function csatMultiplier(date: string): number {
  const d = diffDays(date, EXAMS.csat);
  return d >= 0 && d <= 30 ? 1 + 0.5 * (1 - d / 30) : 1;
}
/** 토익: 시험 D-14부터 1.3배 (어학·토익 유형). */
export const toeicMultiplier = (date: string) => (EXAMS.toeic.some((e) => { const d = diffDays(date, e); return d >= 0 && d <= 14; }) ? 1.3 : 1);
export const inRange = (date: string, from: string, to: string) => date >= from && date <= to;
export const isChuseok = (date: string) => CHUSEOK.some(([a, b]) => inRange(date, a, b));
export const isSaleWeek = (date: string) => inRange(date, LATE_NOV_SALE.from, LATE_NOV_SALE.to);
export const discountShareOn = (date: string) => (isSaleWeek(date) ? DISCOUNT.saleWeekShare : DISCOUNT.share);

export type ExamKey = "csat" | "jeongcheogi" | "realtor" | "toeic";

/** 그날 분야별 결제 배수. exam을 주면 그 유형의 시험(자격증은 정처기·공인중개사 각각)으로. */
export function categoryMultipliers(date: string, exam?: ExamKey): Record<Cat, number> {
  const m = Object.fromEntries(CATEGORY_CODES.map((c) => [c, 1])) as Record<Cat, number>;
  m.CERT =
    exam === "jeongcheogi"
      ? examWave(date, EXAMS.jeongcheogi.end, EXAMS.jeongcheogi.peak)
      : exam === "realtor"
        ? examWave(date, EXAMS.realtor.date, EXAMS.realtor.peak)
        : certMultiplier(date);
  m.EXAM = csatMultiplier(date);
  if (exam === "toeic") m.LANG = toeicMultiplier(date);
  if (isChuseok(date)) for (const c of CATEGORY_CODES) if (c !== "CERT" && c !== "EXAM") m[c] *= CHUSEOK_FACTOR;
  if (inRange(date, POST_CSAT.from, POST_CSAT.to)) {
    m.EXAM *= POST_CSAT.exam;
    m.CERT *= POST_CSAT.shift;
    m.LANG *= POST_CSAT.shift;
    m.DEV *= POST_CSAT.shift;
  }
  if (isSaleWeek(date)) for (const c of CATEGORY_CODES) m[c] *= LATE_NOV_SALE.factor;
  if (inRange(date, NEW_YEAR.from, NEW_YEAR.to)) for (const c of CATEGORY_CODES) m[c] *= c === "LANG" || c === "CERT" ? NEW_YEAR.langCert : NEW_YEAR.factor;
  return m;
}

// ── 심어 둔 사건 (설계 6절) ──
export const PLANTED = {
  certSpike: {
    name: "폭주 1: 공인중개사 가답안 공개 뒤 자격증 해설 접속",
    date: "2026-10-31",
    fromHour: 18,
    toHour: 21, // 21시 전까지
    factor: 4,
    /** 그 저녁 자격증 수강생 중 해설 다시보기를 여는 몫 (평소 저녁 시청의 약 4배가 되게) */
    rewatchShare: 0.35,
    hourFactors: { 18: 3.5, 19: 4.5, 20: 4.0 } as Record<number, number>,
  },
  fault: {
    name: "심어 둔 장애: 영상 진도 저장 오류",
    date: "2026-11-02",
    from: [9, 0] as const,
    to: [9, 40] as const,
    errorRate: 0.35,
    inquiries: 30,
    inquiryUntil: [10, 30] as const,
    answerAt: [11, 0] as const,
    compensation: { date: "2026-11-03", hour: 10, code: "SYNTH-SORRY1102", amount: 5_000, days: 30, useRate: 0.3 },
  },
  csatLive: {
    name: "폭주 2: 수능 당일 저녁 해설 라이브",
    date: "2026-11-19",
    hour: 20,
    minutes: 120,
    capacity: 3_000,
    title: "2027 수능 해설 라이브: 국어·수학 총평과 등급컷",
    description: "수능을 마친 수험생과 함께 국어·수학 총평과 예상 등급컷을 살펴봐요. 회원이면 누구나 들어올 수 있어요.",
    by: "math-lighthouse",
    pageFactors: { 19: 5, 20: 10, 21: 8, 22: 5 } as Record<number, number>,
    entryFactor: [5, 10] as const,
    /** 수능·내신 관심 회원이 예약하는 몫 (평소 라이브 입장의 5~10배가 되게, 판단) */
    reserveShare: 0.03,
  },
} as const;

export const faultWindow = (date = PLANTED.fault.date) => ({
  from: kstDateTime(date, PLANTED.fault.from[0], PLANTED.fault.from[1]).getTime(),
  to: kstDateTime(date, PLANTED.fault.to[0], PLANTED.fault.to[1]).getTime(),
});
export const inFault = (t: number) => {
  const w = faultWindow();
  return t >= w.from && t < w.to;
};

// ── 라이브 (판단) ──
export const LIVE_RATES = {
  courseReserve: 0.18, // 강의 라이브: 그 강의 수강생 중 예약
  openReserve: 0.006, // 단독 라이브: 관심 분야 회원 중 예약
  enter: 0.7, // 예약자 중 입장
  chat: 0.15, // 입장자 중 채팅
  planDaysBefore: 8, // 시작 8일 전 0시에 예약·입장 계획
};
export const LIVE_CHATS = ["안녕하세요! 오늘도 잘 부탁드려요.", "질문 있어요, 아까 그 부분 다시 설명해 주실 수 있나요?", "정리 감사합니다 👍", "화면 잘 보여요.", "다음 라이브도 기다릴게요."];

// ── 학습자 유형 (설계 4절 per) ──
export type Completion = "아주 높음" | "높음" | "중간" | "낮음";
export const COMPLETION_TILT: Record<Completion, number> = { "아주 높음": 1.4, 높음: 1.2, 중간: 1, 낮음: 0.8 };

export interface Persona {
  code: string;
  name: string;
  desc: string;
  share: number; // 회원 비중 (%)
  spend: number | null; // 연 지출(만 원). null = 평균
  ages: readonly [number, number];
  female: number;
  cats: Partial<Record<Cat, number>> | null; // 주 분야 (null = 전체 평균)
  buy: readonly [number, number, number, number]; // 단과·패키지·월 구독·연 구독 기울기
  hours: HourProfile;
  boost?: Readonly<Record<number, number>>; // 시간대 덧칠
  completion: Completion;
  exam?: ExamKey;
  pace: number; // 시청 사이 평균 간격(일)
  blankProfile?: boolean;
}

export const PERSONAS: readonly Persona[] = [
  { code: "csat3", name: "고3 수험생", desc: "10대 · 남녀 · 학생", share: 9, spend: 28, ages: [18, 18], female: 0.5, cats: { EXAM: 1 }, buy: [1, 0.4, 0.1, 0.03], hours: "teen", boost: { 22: 1.3, 23: 1.3 }, completion: "높음", exam: "csat", pace: 1.5 },
  { code: "hs12", name: "고1·2 내신", desc: "10대 · 남녀 · 학생", share: 8, spend: 18, ages: [16, 17], female: 0.5, cats: { EXAM: 0.75, LANG: 0.25 }, buy: [1, 0.05, 0.1, 0.02], hours: "teen", boost: { 21: 1.3, 22: 1.2 }, completion: "중간", exam: "csat", pace: 2.5 },
  { code: "uni_dev", name: "대학생 개발 입문", desc: "20대 · 남녀 · 학생", share: 9, spend: 15, ages: [20, 25], female: 0.4, cats: { DEV: 0.65, DATA: 0.35 }, buy: [1, 0.15, 0.15, 0.03], hours: "twenties", boost: { 0: 1.4, 1: 1.4 }, completion: "낮음", pace: 3.5 },
  { code: "jobseek_cert", name: "취준생 자격증", desc: "20대 · 남녀 · 구직", share: 8, spend: 20, ages: [23, 29], female: 0.5, cats: { CERT: 0.75, LANG: 0.25 }, buy: [1, 0.5, 0.1, 0.03], hours: "twenties", boost: { 13: 1.6, 14: 1.6, 15: 1.6, 16: 1.5 }, completion: "높음", exam: "jeongcheogi", pace: 1.5 },
  { code: "toeic", name: "토익 준비", desc: "20대 · 남녀 · 학생·구직", share: 6, spend: 12, ages: [21, 28], female: 0.55, cats: { LANG: 1 }, buy: [0.6, 0, 1.6, 0.1], hours: "twenties", completion: "중간", exam: "toeic", pace: 2.5 },
  { code: "junior_dev", name: "주니어 개발자", desc: "20~30대 · 남 · 직장인", share: 8, spend: 30, ages: [25, 34], female: 0.2, cats: { DEV: 0.6, DATA: 0.4 }, buy: [1, 0.2, 0.3, 0.6], hours: "thirties", completion: "중간", pace: 2.5 },
  { code: "ai_worker", name: "AI 전환 직장인", desc: "30~40대 · 남녀 · 직장인", share: 8, spend: 26, ages: [30, 49], female: 0.45, cats: { DATA: 0.6, BIZ: 0.4 }, buy: [1, 0.3, 0.15, 0.05], hours: "thirties", boost: { 6: 2, 7: 2, 22: 1.3 }, completion: "낮음", pace: 3.5 },
  { code: "realtor", name: "공인중개사 준비", desc: "40~50대 · 남녀 · 직장인·자영업", share: 6, spend: 35, ages: [40, 59], female: 0.5, cats: { CERT: 1 }, buy: [1, 1.2, 0.05, 0.02], hours: "mixed", boost: { 7: 1.5, 8: 1.5, 9: 1.4, 21: 1.4, 22: 1.4 }, completion: "아주 높음", exam: "realtor", pace: 1.5 },
  { code: "eng_worker", name: "직장인 영어회화", desc: "30~40대 · 여 · 직장인", share: 7, spend: 14, ages: [30, 45], female: 0.85, cats: { LANG: 1 }, buy: [0.6, 0, 1.6, 0.2], hours: "thirties", boost: { 7: 2.2, 8: 2.2, 12: 2.4, 18: 1.8 }, completion: "낮음", pace: 3.5 },
  { code: "designer", name: "디자인 툴 학습", desc: "20~30대 · 여 · 직장인·프리랜서", share: 7, spend: 16, ages: [22, 35], female: 0.8, cats: { DSGN: 1 }, buy: [1, 0.15, 0.1, 0.03], hours: "twenties", boost: { 22: 1.2, 23: 1.3 }, completion: "낮음", pace: 3.5 },
  { code: "marketer", name: "마케터 실무", desc: "20~30대 · 남녀 · 직장인", share: 6, spend: 18, ages: [24, 37], female: 0.55, cats: { BIZ: 0.65, DATA: 0.35 }, buy: [1, 0.2, 0.1, 0.03], hours: "thirties", boost: { 12: 2.2, 22: 1.3 }, completion: "낮음", pace: 3.5 },
  { code: "senior", name: "시니어 교양", desc: "50대 이상 · 남녀", share: 3, spend: 8, ages: [50, 70], female: 0.5, cats: { LANG: 0.5, BIZ: 0.5 }, buy: [1, 0, 0.1, 0.02], hours: "senior", completion: "중간", pace: 2.5 },
  { code: "blank", name: "프로필 비움", desc: "선택 항목 없음", share: 5, spend: null, ages: [17, 60], female: 0.5, cats: null, buy: [72, 8, 16, 4], hours: "mixed", completion: "중간", pace: 3, blankProfile: true },
];

// ── 보정 ──
/** 행 비율 맞추기(IPF): 행마다 합 1을 지키면서, 행 무게로 더한 열 합이 목표 비중이 되게(맞출 수 없으면 가장 가깝게). 0인 칸은 0으로 남는다. */
export function fitRows(rows: number[][], rowMass: number[], target: number[], iters = 1000): number[][] {
  const t = normalize(target);
  const total = rowMass.reduce((a, b) => a + b, 0);
  let r = rows.map((row) => normalize(row));
  for (let it = 0; it < iters; it++) {
    const col = t.map((_, j) => r.reduce((s, row, i) => s + rowMass[i] * row[j], 0) / total);
    r = r.map((row) => normalize(row.map((v, j) => (col[j] > 0 ? (v * t[j]) / col[j] : v))));
  }
  return r;
}
export function normalize(v: number[]): number[] {
  const s = v.reduce((a, b) => a + b, 0);
  return s > 0 ? v.map((x) => x / s) : v.map(() => 1 / v.length);
}

/** 유형별 연 지출(만 원): "평균" 유형은 다른 유형의 회원 가중 평균, 그 뒤 전체 평균이 SPEND_MEAN이 되게 줄인다. */
export function personaSpend(): number[] {
  const known = PERSONAS.filter((p) => p.spend !== null);
  const avg = known.reduce((s, p) => s + p.share * p.spend!, 0) / known.reduce((s, p) => s + p.share, 0);
  const raw = PERSONAS.map((p) => p.spend ?? avg);
  const mean = raw.reduce((s, v, i) => s + v * PERSONAS[i].share, 0) / PERSONAS.reduce((s, p) => s + p.share, 0);
  return raw.map((v) => (v * SPEND_MEAN) / mean);
}
/** 회원 1명 평균 연 결제 수 (= 하루 130건 × 365 ÷ 3만 명). */
export const ORDERS_PER_MEMBER_YEAR = (ORDERS_PER_DAY * 365) / MEMBERS;
/** 유형별 결제 무게 (회원 비중 × 연 지출). */
export const personaMass = () => {
  const sp = personaSpend();
  return PERSONAS.map((p, i) => p.share * sp[i]);
};

/** 패키지가 있는 분야 (패키지 첫 강의의 분야). */
export const bundleCats = (): ReadonlySet<Cat> => new Set(catalog().bundles.map((b) => b.cat));

export interface Calibration {
  cat: number[][]; // 유형 × CATEGORY_CODES
  buy: number[][]; // 유형 × PRODUCT_KINDS
  device: Record<"teen" | "adult" | "senior", number[]>;
  completionNorm: number;
}

let calibrationCache: Calibration | null = null;
export function calibration(): Calibration {
  if (calibrationCache) return calibrationCache;
  const mass = personaMass();
  const catRows = PERSONAS.map((p) => CATEGORY_CODES.map((c) => (p.cats ? (p.cats[c] ?? 0) : CATEGORY_SHARE[c])));
  const cat = fitRows(catRows, mass, CATEGORY_CODES.map((c) => CATEGORY_SHARE[c]));
  const buyRows = PERSONAS.map((p, i) => {
    const bundleOk = CATEGORY_CODES.some((c, j) => bundleCats().has(c) && cat[i][j] > 0);
    return [p.buy[0], bundleOk ? p.buy[1] : 0, p.buy[2], p.buy[3]];
  });
  const buy = fitRows(buyRows, mass, [...PRODUCT_MIX]);
  // 기기: 회원 비중으로, 연령대 기울기를 전체 비중에 맞춘다
  const groups = ["teen", "adult", "senior"] as const;
  const gMass = groups.map((g) => PERSONAS.reduce((s, p) => s + (ageGroup(p) === g ? p.share : 0), 0));
  const fitted = fitRows(groups.map((g) => DEVICE_TILT[g]), gMass, [...DEVICE_SHARE]);
  const device = { teen: fitted[0], adult: fitted[1], senior: fitted[2] };
  // 완강 성향: 결제 무게로 평균 1
  const completionNorm = PERSONAS.reduce((s, p, i) => s + mass[i] * COMPLETION_TILT[p.completion], 0) / mass.reduce((a, b) => a + b, 0);
  calibrationCache = { cat, buy, device, completionNorm };
  return calibrationCache;
}
const ageGroup = (p: Persona): "teen" | "adult" | "senior" => (p.ages[1] < 20 ? "teen" : p.ages[0] >= 50 ? "senior" : "adult");

// ── 강의 목록 (시드 데이터와 같은 규칙: seed-lib planCurriculum) ──
export interface CourseInfo {
  code: string;
  title: string;
  cat: Cat;
  instructor: string; // 강사 slug
  price: number;
  inSubscription: boolean;
  durations: number[]; // 강 길이(초), 순서대로
  group: "jeongcheogi" | "cert_other" | null;
}
export interface BundleInfo {
  code: string;
  title: string;
  cat: Cat;
  courses: string[]; // 강의 코드
}
interface Catalog {
  courses: CourseInfo[];
  byCode: Map<string, CourseInfo>;
  byTitle: Map<string, CourseInfo>;
  bundles: BundleInfo[];
  byCat: Record<Cat, CourseInfo[]>;
  subByCat: Record<Cat, CourseInfo[]>;
}
let catalogCache: Catalog | null = null;
export function catalog(): Catalog {
  if (catalogCache) return catalogCache;
  const codes = courseCodes();
  const courses: CourseInfo[] = [];
  let pub = 0;
  COURSES.forEach((c, i) => {
    if (c.status) return; // 심사 중·임시 강의는 팔지 않는다
    const p = pub++;
    const durations = planCurriculum(codes[i], c.cur).flatMap((s) => s.lectures.map((l) => l.duration_sec));
    courses.push({
      code: codes[i],
      title: c.title,
      cat: c.cat,
      instructor: c.by,
      price: c.price,
      inSubscription: p % 10 < 7, // seed-lib와 같은 규칙
      durations,
      group: c.cat !== "CERT" ? null : c.title.includes("정보처리기사") ? "jeongcheogi" : "cert_other",
    });
  });
  const byCode = new Map(courses.map((c) => [c.code, c]));
  const byTitle = new Map(courses.map((c) => [c.title, c]));
  const bundles = BUNDLES.map((b) => {
    const cs = b.courses.map((t) => byTitle.get(t)!);
    return { code: b.code, title: b.title, cat: cs[0].cat, courses: cs.map((c) => c.code) };
  });
  const byCat = Object.fromEntries(CATEGORY_CODES.map((k) => [k, courses.filter((c) => c.cat === k)])) as Record<Cat, CourseInfo[]>;
  const subByCat = Object.fromEntries(CATEGORY_CODES.map((k) => [k, byCat[k].filter((c) => c.inSubscription)])) as Record<Cat, CourseInfo[]>;
  catalogCache = { courses, byCode, byTitle, bundles, byCat, subByCat };
  return catalogCache;
}

/** 강의 인기 (같은 강의는 늘 같은 값, 0.5~1.5). */
function popularity(code: string): number {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 16777619);
  return 0.5 + ((h >>> 0) % 1000) / 1000;
}

/** 이 유형이 이 강의를 고를 무게 (시험 유형은 그 시험 강의로 몰린다). */
export function courseWeight(c: CourseInfo, persona: Persona, date: string): number {
  let w = popularity(c.code);
  if (c.group === "jeongcheogi") w *= persona.exam === "jeongcheogi" ? 4 : persona.exam === "realtor" ? 0.2 : 1;
  if (c.group === "jeongcheogi" && c.title.includes("D-30")) w *= diffDays(date, EXAMS.jeongcheogi.end) <= 30 && diffDays(date, EXAMS.jeongcheogi.end) >= 0 ? 3 : 0.3;
  if (c.group === "cert_other") w *= persona.exam === "realtor" ? 4 : 1;
  if (c.title.includes("토익")) w *= persona.exam === "toeic" ? 6 : 1;
  if (c.cat === "EXAM" && persona.code === "hs12") w *= c.title.includes("고1") || c.title.includes("통합과학") ? 3 : 0.7;
  return w;
}

// ── 회원 ──
export interface Member {
  index: number; // 0부터
  email: string;
  name: string;
  phone: string;
  gender: "F" | "M";
  birthYear: number | null;
  age: number;
  persona: number;
  joinedAt: number; // ms
  joinedInWindow: boolean;
  marketing: boolean;
  interests: Cat[];
  ordersPerYear: number;
  catW: number[];
  completion: number; // 완강 성향 배수 (평균 1)
  devices: DeviceType[];
  hourStrength: number;
}

export interface ModelConfig {
  seed: number;
  /** 기간 마지막 날(한국 날짜, 되채우기한 날). */
  windowEnd: string;
  /** 되채우기가 넣은 마지막 시각(ms). 새 회원의 가입은 그 전. */
  cutoff: number;
  members?: number;
  newMembers?: number;
}

export interface Model {
  seed: number;
  windowStart: string;
  windowEnd: string;
  cutoff: number;
  members: Member[];
  calib: Calibration;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
export const memberEmail = (index: number) => `m${pad(index + 1, 5)}@${SYNTH_DOMAIN}`;
export const deviceKey = (index: number, k: number) => `${SYNTH_DEVICE_PREFIX}m${pad(index + 1, 5)}-${k + 1}`;
export const windowStartOf = (end: string) => addDays(end, -WINDOW_DAYS);

export function buildModel(cfg: ModelConfig): Model {
  const count = cfg.members ?? MEMBERS;
  const fresh = Math.min(count, cfg.newMembers ?? NEW_MEMBERS);
  const windowStart = windowStartOf(cfg.windowEnd);
  const startMs = kstDateTime(windowStart).getTime();
  const calib = calibration();
  const spend = personaSpend();
  const rng = new Rng(`${cfg.seed}:members`);
  const personaW = PERSONAS.map((p) => p.share);
  const joinHours = hourCum("mixed", 1);

  // 가입 시각: 예전 회원은 기간 전 3년 안, 새 회원은 기간 안. 이메일 번호가 가입 순서가 되게 정렬한다.
  const oldJoins = Array.from({ length: count - fresh }, () => startMs - rng.uniform(1, 1095) * 86_400_000);
  const span = Math.max(60_000, cfg.cutoff - startMs);
  const newJoins = Array.from({ length: fresh }, () => {
    const day = Math.floor(rng.random() * (span / 86_400_000));
    const date = addDays(windowStart, day);
    const hour = bisect(joinHours, rng.random() * joinHours[23]);
    const t = kstDateTime(date, hour, rng.int(0, 59), rng.int(0, 59)).getTime();
    return Math.min(t, cfg.cutoff - rng.uniform(5, 600) * 60_000);
  });
  oldJoins.sort((a, b) => a - b);
  newJoins.sort((a, b) => a - b);
  const joins = [...oldJoins, ...newJoins];
  const endYear = Number(cfg.windowEnd.slice(0, 4));

  const members: Member[] = [];
  for (let i = 0; i < count; i++) {
    const pi = rng.index(personaW);
    const p = PERSONAS[pi];
    const gender = rng.chance(p.female) ? "F" : "M";
    const age = rng.int(p.ages[0], p.ages[1]);
    const birth = endYear - age - (rng.chance(0.85) ? 0 : 1);
    const s = rng.index(SURNAMES.map((x) => x[2]));
    const [given] = rng.pick(givenPool(birth, gender));
    const catW = normalize(calib.cat[pi].map((w) => w * rng.jitter(JITTER)));
    const devTilt = calib.device[ageGroup(p)];
    const first = DEVICE_TYPES[rng.index(devTilt)];
    const devices: DeviceType[] = [first];
    if (rng.chance(TWO_DEVICE_SHARE)) devices.push(DEVICE_TYPES[rng.index(devTilt.map((w, j) => (DEVICE_TYPES[j] === first ? 0 : w)))]);
    members.push({
      index: i,
      email: memberEmail(i),
      name: SURNAMES[s][0] + given,
      phone: `010${pad(rng.int(0, 99_999_999), 8)}`,
      gender,
      birthYear: p.blankProfile ? null : birth,
      age,
      persona: pi,
      joinedAt: Math.floor(joins[i] / 1000) * 1000,
      joinedInWindow: i >= count - fresh,
      marketing: rng.chance(0.35),
      interests: p.blankProfile ? [] : CATEGORY_CODES.filter((c) => (p.cats?.[c] ?? 0) > 0),
      ordersPerYear: (ORDERS_PER_MEMBER_YEAR * spend[pi] * rng.jitter(JITTER)) / SPEND_MEAN,
      catW,
      completion: (COMPLETION_TILT[p.completion] / calib.completionNorm) * rng.jitter(JITTER),
      devices,
      hourStrength: rng.jitter(JITTER),
    });
  }
  return { seed: cfg.seed, windowStart, windowEnd: cfg.windowEnd, cutoff: cfg.cutoff, members, calib };
}

/** 회원의 연령대 (정답지 비교용). */
export function ageBand(m: Pick<Member, "birthYear" | "age">): string {
  if (m.birthYear === null) return "비움";
  if (m.age < 20) return "10대";
  if (m.age < 30) return "20대";
  if (m.age < 40) return "30대";
  if (m.age < 50) return "40대";
  return "50대 이상";
}

// ── 시간대 ──
const hourCache = new Map<string, number[]>();
export function hourWeights(profile: HourProfile, boost?: Readonly<Record<number, number>>, strength = 1): number[] {
  const base =
    profile === "mixed"
      ? Array.from({ length: 24 }, (_, h) => (HRS.teen[h] + HRS.twenties[h] + HRS.thirties[h] + HRS.senior[h]) / 4)
      : [...HRS[profile]];
  return base.map((v, h) => v * (1 + ((boost?.[h] ?? 1) - 1) * strength));
}
export function hourCum(profile: HourProfile, strength: number, boost?: Readonly<Record<number, number>>, key = ""): number[] {
  const k = `${profile}:${key}:${strength.toFixed(1)}`;
  const hit = hourCache.get(k);
  if (hit) return hit;
  const cum = cumulative(hourWeights(profile, boost, strength));
  hourCache.set(k, cum);
  return cum;
}
export const personaHours = (m: Member) => {
  const p = PERSONAS[m.persona];
  return hourCum(p.hours, m.hourStrength, p.boost, p.code);
};
/** 그날 그 회원이 활동할 시각 (ms). */
export function sampleTime(rng: Rng, m: Member, date: string): number {
  const cum = personaHours(m);
  const h = bisect(cum, rng.random() * cum[23]);
  return kstDateTime(date, h, rng.int(0, 59), rng.int(0, 59)).getTime();
}

// ── 하루 계획 ──
export interface RefundFate {
  early: boolean;
  delayH: number;
  decideH: number;
  reject: boolean;
  reason: number;
}
export interface Fate {
  payDelayMin: number;
  discountU: number;
  coupon: number; // SALE_COUPONS 번호
  card: string; // 구독 카드 끝 4자리
  refund: RefundFate | null;
  inquiry: null | { delayH: number; kind: number; answerH: number };
}

export interface Intent {
  key: string; // 날짜#순번
  t: number;
  day: string;
  member: number;
  persona: number;
  kind: ProductKind;
  cat: Cat;
  /** 단과: 강의 코드 후보(앞이 첫 선택), 패키지: 패키지 코드 후보, 구독: 볼 강의 순서 */
  candidates: string[];
  fate: Fate;
}

export interface DayPlan {
  date: string;
  dowIndex: number;
  multipliers: Record<Cat, number>;
  expected: number;
  expectedByCat: Record<Cat, number>;
  discountShare: number;
  intents: Intent[];
}

export const REFUND_REASONS = [
  "생각했던 내용과 달라서요.",
  "시간이 없어 들을 수가 없을 것 같아요.",
  "같은 내용을 다른 곳에서 이미 들었어요.",
  "강의 속도가 저와 맞지 않아요.",
  "실수로 결제했어요.",
];

/**
 * 한국 날짜 하루의 결제 계획. 회원마다 그날 기대값 λ(연 결제/365 × 요일 × 분야별 시험·할인 배수)를 더해 포아송으로
 * 결제 수를 뽑고, λ에 비례해 회원을 고른다(회원마다 포아송으로 뽑는 것과 같은 분포).
 */
export function planDay(model: Model, date: string): DayPlan {
  const rng = new Rng(`${model.seed}:day:${date}`);
  const dayStart = kstDateTime(date).getTime();
  const dayEnd = dayStart + 86_400_000;
  const dow = dowIndex(date);
  const multByExam = new Map<string, Record<Cat, number>>();
  const multFor = (p: Persona) => {
    const k = p.exam ?? "";
    let m = multByExam.get(k);
    if (!m) multByExam.set(k, (m = categoryMultipliers(date, p.exam)));
    return m;
  };
  const lam = new Float64Array(model.members.length);
  const expectedByCat = Object.fromEntries(CATEGORY_CODES.map((c) => [c, 0])) as Record<Cat, number>;
  let total = 0;
  for (const m of model.members) {
    if (m.joinedAt >= dayEnd) continue;
    const part = m.joinedAt > dayStart ? (dayEnd - m.joinedAt) / 86_400_000 : 1;
    const rate = (m.ordersPerYear / 365) * dow * part;
    const mult = multFor(PERSONAS[m.persona]);
    let s = 0;
    CATEGORY_CODES.forEach((c, j) => {
      const v = rate * m.catW[j] * mult[c];
      s += v;
      expectedByCat[c] += v;
    });
    lam[m.index] = s;
    total += s;
  }
  const cum = cumulative(Array.from(lam));
  const n = rng.poisson(total);
  const slots: { t: number; member: number }[] = [];
  for (let k = 0; k < n; k++) {
    const mi = bisect(cum, rng.random() * total);
    const m = model.members[mi];
    let t = 0;
    for (let tries = 0; tries < 20; tries++) {
      t = sampleTime(rng, m, date);
      if (t > m.joinedAt) break;
    }
    if (t <= m.joinedAt) t = m.joinedAt + rng.int(5, 120) * 60_000;
    if (t >= dayEnd) continue;
    slots.push({ t, member: mi });
  }
  slots.sort((a, b) => a.t - b.t || a.member - b.member);
  const intents = slots.map((s, k) => makeIntent(model, date, k, s.t, s.member, multFor(PERSONAS[model.members[s.member].persona])));
  return {
    date,
    dowIndex: dow,
    multipliers: categoryMultipliers(date),
    expected: total,
    expectedByCat,
    discountShare: discountShareOn(date),
    intents,
  };
}

function makeIntent(model: Model, date: string, k: number, t: number, mi: number, mult: Record<Cat, number>): Intent {
  const key = `${date}#${pad(k, 4)}`;
  const rng = new Rng(`${model.seed}:intent:${key}`);
  const m = model.members[mi];
  const p = PERSONAS[m.persona];
  const cat = CATEGORY_CODES[rng.index(CATEGORY_CODES.map((c, j) => m.catW[j] * mult[c]))];
  let kind = PRODUCT_KINDS[rng.index(model.calib.buy[m.persona])];
  if (kind === "bundle" && !bundleCats().has(cat)) kind = "single";
  const cat0 = catalog();
  let candidates: string[];
  if (kind === "single") candidates = pickWeighted(rng, cat0.byCat[cat], (c) => courseWeight(c, p, date), 5).map((c) => c.code);
  else if (kind === "bundle") {
    const list = cat0.bundles.filter((b) => b.cat === cat);
    candidates = pickWeighted(rng, list, (b) => (b.code === "SO-PKG-0002" && p.exam === "jeongcheogi" ? 3 : 1), list.length).map((b) => b.code);
  } else {
    // 구독: 관심 분야의 구독 대상 강의 (월 2~4개, 연 3~6개)
    const want = kind === "monthly" ? rng.int(2, 4) : rng.int(3, 6);
    const pool = CATEGORY_CODES.flatMap((c, j) => cat0.subByCat[c].map((course) => ({ course, w: (m.catW[j] + 0.02) * courseWeight(course, p, date) * (c === cat ? 3 : 1) })));
    candidates = pickWeighted(rng, pool, (x) => x.w, want).map((x) => x.course.code);
  }
  const refundRate = REFUND_RATE[kind] * (kind === "single" || kind === "bundle" ? REFUND_SKEW[cat] : 1);
  const early = rng.chance(RATES.refundEarly);
  const refund: RefundFate | null = rng.chance(refundRate)
    ? {
        early,
        delayH: early ? rng.uniform(3, 6 * 24) : kind === "yearly" ? rng.uniform(8 * 24, 50 * 24) : rng.uniform(8 * 24, 30 * 24),
        decideH: rng.uniform(2, 26),
        reject: rng.chance(RATES.refundReject),
        reason: rng.int(0, REFUND_REASONS.length - 1),
      }
    : null;
  let card = pad(rng.int(0, 9999), 4);
  if (card === FAIL_CARD) card = "4001";
  return {
    key,
    t,
    day: date,
    member: mi,
    persona: m.persona,
    kind,
    cat,
    candidates,
    fate: {
      payDelayMin: Math.min(25, Math.max(1, rng.lognormal(3, 0.8))),
      discountU: rng.random(),
      coupon: rng.index(SALE_COUPONS.map((c) => c[2])),
      card,
      refund,
      inquiry: rng.chance(RATES.inquiry) ? { delayH: rng.uniform(1, 10 * 24), kind: rng.int(0, 99), answerH: rng.uniform(1, 30) } : null,
    },
  };
}

/** 무게대로 겹치지 않게 max개. */
export function pickWeighted<T>(rng: Rng, items: readonly T[], weight: (x: T) => number, max: number): T[] {
  const w = items.map(weight);
  const out: T[] = [];
  while (out.length < max && w.some((x) => x > 0)) {
    const i = rng.index(w);
    out.push(items[i]);
    w[i] = 0;
  }
  return out;
}

// ── 시청 (설계 5절) ──
/** 수강권 하나의 시청 흐름 (사건 줄에 그대로 저장한다). */
export interface Chain {
  member: number;
  course: string;
  key: string; // 수강권 열쇠 (구매 열쇠:강의)
  seq: number; // 다음 세션 번호
  reach: number; // 여는 마지막 강 (1부터, 0이면 안 봄)
  lastFrac: number; // 마지막 강을 보는 몫 (1 = 끝까지)
  lec: number; // 지금 강 (0부터)
  pos: number; // 그 강에서 본 곳 (초)
  sub: boolean;
}
export interface Piece {
  lec: number;
  from: number;
  to: number;
  rate: number;
  /** 세션 시작부터 이 조각 재생을 시작하기까지 (초, 벽시계) */
  at: number;
}
export interface Session {
  t: number;
  device: number;
  pieces: Piece[];
  /** 이 세션을 다 보면 다음 상태 */
  after: Chain;
  /** 이 세션으로 시청이 끝나는지 */
  last: boolean;
}

/** 수강권의 마지막 강 비율 (분야·완강 성향·구독). */
export function finalShare(m: Member, c: CourseInfo, sub: boolean): number {
  return Math.min(DROP.third, Math.max(0.02, FINAL_BY_CAT[c.cat] * m.completion * (sub ? SUB_FINAL_FACTOR : 1)));
}

/** 시청 흐름 시작: 몇 강까지 볼지 정한다. scale은 곡선 배수(패키지 두 번째 강의부터 0.7). */
export function startChain(model: Model, member: number, course: string, key: string, opts: { sub?: boolean; scale?: number; refundEarly?: boolean } = {}): Chain {
  const rng = new Rng(`${model.seed}:chain:${key}`);
  const m = model.members[member];
  const c = catalog().byCode.get(course)!;
  const n = c.durations.length;
  let reach = sampleReach(rng.random(), n, finalShare(m, c, !!opts.sub), opts.scale ?? 1);
  let lastFrac = reach < n && rng.chance(0.6) ? rng.uniform(0.15, 0.85) : 1;
  if (opts.refundEarly) {
    // 7일 안·진도 5% 미만에 환불하는 사람은 1강 앞부분만
    reach = Math.min(reach, 1);
    lastFrac = rng.uniform(0.05, 0.3);
  }
  return { member, course, key, seq: 0, reach, lastFrac, lec: 0, pos: 0, sub: !!opts.sub };
}

/** 첫 시청 시각: 결제 뒤 30분~2일 (대부분 그날·다음 날). */
export function firstWatchAt(model: Model, chain: Chain, t0: number, delayDays = 0): number {
  const rng = new Rng(`${model.seed}:first:${chain.key}`);
  const m = model.members[chain.member];
  const back = t0 + delayDays * 86_400_000 + Math.min(48, Math.max(0.5, rng.lognormal(8, 0.9))) * 3_600_000;
  const day = kstDate(new Date(back));
  for (let k = 0; k < 4; k++) {
    const t = sampleTime(rng, m, addDays(day, k));
    if (t > t0 + 20 * 60_000) return t;
  }
  return back;
}

/** 다음 세션 (없으면 null). 같은 흐름·같은 번호면 늘 같은 세션. */
export function nextSession(model: Model, chain: Chain, t: number): Session | null {
  const c = catalog().byCode.get(chain.course)!;
  if (chain.reach <= 0 || chain.lec >= chain.reach) return null;
  const rng = new Rng(`${model.seed}:session:${chain.key}:${chain.seq}`);
  const m = model.members[chain.member];
  const rate = RATE_CHOICES[rng.index(RATE_CHOICES.map((r) => r[1]))][0];
  let budget = rng.uniform(SESSION_MIN[0], SESSION_MIN[1]) * 60; // 벽시계 초
  const pieces: Piece[] = [];
  let { lec, pos } = chain;
  let at = 0;
  let last = false;
  while (budget >= 60) {
    const dur = c.durations[lec];
    const end = lec === chain.reach - 1 && chain.lastFrac < 1 ? Math.max(10, Math.floor(dur * chain.lastFrac)) : dur;
    if (pos >= end) {
      if (lec >= chain.reach - 1) {
        last = true;
        break;
      }
      lec++;
      pos = 0;
      continue;
    }
    const piece = Math.max(1, Math.min(end - pos, Math.floor(budget * rate)));
    pieces.push({ lec, from: pos, to: pos + piece, rate, at: Math.round(at) });
    const wall = piece / rate;
    budget -= wall;
    at += wall + rng.uniform(3, 20);
    pos += piece;
    if (pos >= end) {
      if (lec >= chain.reach - 1) {
        last = true;
        break;
      }
      lec++;
      pos = 0;
    }
  }
  if (!pieces.length) return null;
  return {
    t,
    device: rng.int(0, m.devices.length - 1),
    pieces,
    after: { ...chain, seq: chain.seq + 1, lec, pos },
    last,
  };
}

/** 그다음 세션 시각: 유형의 간격(로그정규, 평균 pace일) 뒤 그 회원의 시간대. 금·토는 조금 미룬다(요일 효과). */
export function nextSessionAt(model: Model, chain: Chain, prevEnd: number): number {
  const rng = new Rng(`${model.seed}:gap:${chain.key}:${chain.seq}`);
  const m = model.members[chain.member];
  const p = PERSONAS[m.persona];
  const gap = Math.max(0.3, rng.lognormal(p.pace, 0.6));
  let day = kstDate(new Date(prevEnd + gap * 86_400_000));
  for (let k = 0; k < 3; k++) {
    if (rng.random() < dowIndex(day) / DOW_INDEX[0]) break;
    day = addDays(day, 1);
  }
  for (let k = 0; k < 4; k++) {
    const t = sampleTime(rng, m, addDays(day, k));
    if (t > prevEnd + 30 * 60_000) return t;
  }
  return prevEnd + 86_400_000;
}

/** 지금 강 위치까지 끝낸 강 길이 비율 (서버의 진도율과 같은 기준: 끝낸 강 길이 ÷ 전체). */
export function chainRatio(chain: Pick<Chain, "course" | "lec" | "pos">): number {
  const d = catalog().byCode.get(chain.course)!.durations;
  const total = d.reduce((a, b) => a + b, 0);
  let done = 0;
  for (let i = 0; i < chain.lec; i++) done += d[i];
  if (chain.pos >= 0.9 * d[chain.lec]) done += d[chain.lec];
  return done / total;
}

// ── 라이브 (기간 안 지난 회차) ──
export interface PastLive {
  title: string;
  description: string;
  by: string;
  course: string | null; // 강의 제목
  date: string;
  hour: number;
  minutes: number;
}
/** 시드 라이브 12개를 기간 안 지난 날짜로 한 번씩 (제목에 회차 날짜를 붙여 시드의 자연 키와 겹치지 않게). */
export function pastLives(windowStart: string, windowEnd: string): PastLive[] {
  const span = diffDays(windowStart, windowEnd);
  return LIVE.map((l, i) => {
    const date = addDays(windowStart, 2 + ((i * 5 + l.day) % Math.max(1, span - 3)));
    const [, mm, dd] = date.split("-").map(Number);
    return { title: `${l.title} (${mm}/${dd} 회차)`, description: l.description, by: l.by, course: l.course ?? null, date, hour: l.hour, minutes: l.minutes };
  }).filter((l) => l.date < windowEnd);
}

/** 기간의 날짜들 (시작 ~ 끝, 양 끝 포함). */
export function windowDays(model: Pick<Model, "windowStart" | "windowEnd">): string[] {
  const n = diffDays(model.windowStart, model.windowEnd);
  return Array.from({ length: n + 1 }, (_, i) => addDays(model.windowStart, i));
}

// ── 글 ──
export const INQUIRY_KINDS: readonly { category: "payment" | "refund" | "player" | "subscription" | "live" | "etc"; title: string; body: string; answer: string; w: number }[] = [
  { category: "payment", title: "영수증 발급 문의", body: "회사에 제출할 영수증이 필요해요. 어디서 받을 수 있나요?", answer: "마이페이지 › 주문 내역에서 주문을 누르면 영수증을 받을 수 있어요.", w: 25 },
  { category: "player", title: "영상이 끊겨요", body: "저녁에 강의를 보면 가끔 영상이 멈춰요. 어떻게 하면 될까요?", answer: "브라우저를 새로 고친 뒤 화질을 한 단계 낮춰 보세요. 계속되면 기기와 시간대를 알려 주시면 확인할게요.", w: 25 },
  { category: "etc", title: "수강 기간 문의", body: "수강 기간이 지나면 다시 들을 수 없나요?", answer: "수강 기간이 끝나면 재생은 멈추지만 노트와 진도는 남아 있어요. 다시 결제하면 이어서 볼 수 있어요.", w: 20 },
  { category: "refund", title: "환불 규정 문의", body: "강의를 조금 들었는데 환불하면 얼마나 돌려받나요?", answer: "7일 안·진도 5% 미만이면 전액, 그 밖에는 진도와 기간 중 큰 쪽만큼 빼고 돌려드려요. 주문 상세의 환불 미리 보기에서 금액을 확인할 수 있어요.", w: 15 },
  { category: "player", title: "기기 등록 문의", body: "기기가 2대를 넘었다고 나와요. 새 노트북에서 보려면 어떻게 하나요?", answer: "마이페이지 › 기기 관리에서 쓰지 않는 기기를 해제한 뒤 새 기기에서 재생해 주세요.", w: 15 },
];
export const SUB_INQUIRY = { category: "subscription" as const, title: "구독 결제일 문의", body: "다음 구독 결제는 언제 되나요? 카드를 바꾸고 싶어요.", answer: "다음 결제일은 마이페이지 › 구독에서 볼 수 있어요. 같은 화면에서 카드를 바꾸면 다음 결제부터 새 카드로 결제해요." };
export const FAULT_INQUIRY = {
  category: "player" as const,
  titles: ["진도가 저장이 안 돼요", "강의 보다가 오류가 났어요", "방금 본 강의가 안 본 걸로 나와요"],
  body: "오늘 아침 강의를 봤는데 진도가 저장되지 않고 오류가 났어요. 다시 처음부터 봐야 하나요?",
  answer:
    "오늘 오전 9시부터 약 40분 동안 영상 진도 저장에 장애가 있었어요. 지금은 정상이고, 그 시간에 본 구간은 다시 보시면 이어서 저장돼요. 불편을 드려 죄송해요. 내일 보상 쿠폰을 보내 드릴게요.",
};
export const QUESTION_TEXTS: Record<Cat, readonly [string, string][]> = {
  DEV: [["예제 코드가 실행이 안 돼요", "강의 그대로 따라 쳤는데 오류가 나요. 오류 메시지를 붙여요: TypeError: undefined is not a function"], ["이 부분 동작 원리가 궁금해요", "왜 이렇게 쓰면 결과가 달라지는지 조금 더 설명해 주실 수 있나요?"]],
  DATA: [["데이터 파일 경로 오류", "실습 파일을 불러오면 FileNotFoundError가 나요. 경로를 어떻게 잡아야 하나요?"], ["결과 값이 강의와 달라요", "같은 코드인데 결과 숫자가 조금 달라요. 버전 차이일까요?"]],
  CERT: [["기출 풀이 질문", "이 문제에서 답이 왜 2번인지 잘 모르겠어요. 풀이 순서를 다시 알려 주세요."], ["시험 범위 질문", "이번 회차 시험에도 이 단원이 나오나요?"]],
  LANG: [["발음 질문", "이 표현을 말할 때 연음을 어떻게 하는지 궁금해요."], ["문법 질문", "이 문장에서 관계대명사를 빼도 되나요?"]],
  DSGN: [["실습 파일 질문", "레이어가 강의 화면과 다르게 보여요. 설정을 어떻게 바꾸나요?"]],
  BIZ: [["실무 적용 질문", "회사 보고서에 이 방법을 쓰려면 어떤 지표부터 보면 될까요?"]],
  EXAM: [["풀이 질문", "이 문제를 다른 방법으로 풀어도 되나요? 제 풀이를 적어 봤어요."], ["개념 질문", "이 개념이 다음 단원과 어떻게 이어지는지 궁금해요."]],
};
export const ANSWER_TEXTS = {
  instructor: ["좋은 질문이에요. 강의 7분쯤 화면을 다시 보면서 순서대로 따라가 보세요. 그래도 막히면 코드나 풀이를 붙여 주세요.", "버전 차이 때문이에요. 다음 강 자료에 바뀐 부분을 정리해 두었어요.", "네, 그렇게 풀어도 맞아요. 다만 시험에서는 강의 풀이가 시간이 덜 걸려요."],
  staff: ["운영팀이에요. 강사님께 전달했고, 그 사이 같은 질문의 답변을 강의 Q&A에서 찾아 연결해 드렸어요."],
};
export const RATING_SHARE: readonly [number, number][] = [
  [5, 0.58],
  [4, 0.3],
  [3, 0.08],
  [2, 0.03],
  [1, 0.01],
];

/** 그 시각의 한국 날짜. */
export const kstDayOf = (t: number) => kstDate(new Date(t));
