/** 단계별 서비스 모드 (순수 함수). */
export const MODES = ["normal", "degraded", "read_only", "maintenance"] as const;
export type Mode = (typeof MODES)[number];

/**
 * 기능 분류
 * - heavy: 추천, 검색 자동완성, 후기 쓰기
 * - write: 가입, 주문, 결제, 구독, 환불 신청, 질문·답변, 문의, 노트, 라이브 예약·채팅
 * - play: 재생 시작·하트비트, 라이브 입장
 * - auth: 로그인·로그아웃
 * - browse: 그 밖의 조회
 */
export const FEATURES = ["browse", "auth", "play", "write", "heavy"] as const;
export type Feature = (typeof FEATURES)[number];

const BLOCKED: Record<Mode, readonly Feature[]> = {
  normal: [],
  degraded: ["heavy"],
  read_only: ["write", "heavy"],
  maintenance: FEATURES,
};

export function allows(mode: Mode, feature: Feature): boolean {
  return !BLOCKED[mode].includes(feature);
}

export const isMode = (v: unknown): v is Mode => typeof v === "string" && (MODES as readonly string[]).includes(v);

/** 막혔을 때 수강생에게 보이는 문구. */
export const MODE_MESSAGE: Record<Exclude<Mode, "normal">, string> = {
  degraded: "지금은 접속이 많아 이 기능을 잠시 쉬고 있어요.",
  read_only: "지금은 결제·가입·글쓰기를 잠시 막았어요. 수강은 그대로 할 수 있어요.",
  maintenance: "점검 중이에요. 잠시 후 다시 와 주세요.",
};

export const MODE_LABEL: Record<Mode, string> = {
  normal: "정상",
  degraded: "가볍게 (무거운 기능 끔)",
  read_only: "읽기 전용 (결제·가입·글쓰기 막음)",
  maintenance: "점검 중 (직원만)",
};

/** 제안 기준: 최근 1분 오류율 ≥ 5% 또는 p95 ≥ 1500ms → degraded, 오류율 ≥ 20% 또는 p95 ≥ 5000ms → read_only. */
export const SUGGEST = {
  degraded: { error_rate: 0.05, p95_ms: 1500 },
  read_only: { error_rate: 0.2, p95_ms: 5000 },
} as const;

/** 자동 제안 (바꾸는 것은 직원). maintenance는 제안하지 않는다. */
export function suggestMode(w: { error_rate: number; p95_ms: number }): "degraded" | "read_only" | null {
  if (w.error_rate >= SUGGEST.read_only.error_rate || w.p95_ms >= SUGGEST.read_only.p95_ms) return "read_only";
  if (w.error_rate >= SUGGEST.degraded.error_rate || w.p95_ms >= SUGGEST.degraded.p95_ms) return "degraded";
  return null;
}
