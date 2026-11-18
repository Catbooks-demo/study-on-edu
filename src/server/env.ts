import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? fallback : v.trim().toLowerCase() === "true"));

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().default(""),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  TOSS_CLIENT_KEY: z.string().optional(),
  TOSS_SECRET_KEY: z.string().optional(),
  SEED_STAFF_EMAIL: z.string().optional(),
  SEED_STAFF_PASSWORD: z.string().optional(),
  SEED_INSTRUCTOR_PASSWORD: z.string().optional(),
  JOBS_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() !== "false"),
  /** M1에서 만든 자리. 장애 주입은 M7에서 빼서 지금은 아무것도 켜지 않는다. */
  FAULTS_ENABLED: bool(false),
  /** 플레이어 하트비트 주기(초). e2e는 2. */
  NEXT_PUBLIC_HEARTBEAT_SEC: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v);
      return v && Number.isFinite(n) && n > 0 ? n : 30;
    }),
});

export type Env = z.infer<typeof schema>;

/** 토스 키 검사: 실제 돈이 오가는 live_ 키는 받지 않는다. */
export function assertSafeTossKeys(e: { TOSS_CLIENT_KEY?: string; TOSS_SECRET_KEY?: string }): void {
  for (const k of [e.TOSS_CLIENT_KEY, e.TOSS_SECRET_KEY]) {
    if (k && k.trim().startsWith("live_")) {
      throw new Error("토스 라이브 키는 쓸 수 없어요. 테스트 키(test_)만 넣어 주세요.");
    }
  }
}

/** 운영에서는 세션·쿠키 서명 비밀값이 32자 이상이어야 켜진다 (빌드 단계는 제외). */
export function assertSessionSecret(secret: string): void {
  const production = process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
  if (production && secret.trim().length < 32) {
    throw new Error("SESSION_SECRET을 32자 이상으로 넣어 주세요 (openssl rand -base64 32).");
  }
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.parse(process.env);
  const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  parsed.TOSS_CLIENT_KEY = clean(parsed.TOSS_CLIENT_KEY);
  parsed.TOSS_SECRET_KEY = clean(parsed.TOSS_SECRET_KEY);
  assertSafeTossKeys(parsed);
  assertSessionSecret(parsed.SESSION_SECRET);
  cached = parsed;
  return parsed;
}

/** 시험용: 환경변수를 바꾼 뒤 다시 읽게 한다. */
export function resetEnvCache(): void {
  cached = null;
}

/** 토스 테스트 결제가 켜져 있는지 (두 키가 모두 있을 때만). */
export function tossEnabled(): boolean {
  const e = getEnv();
  return Boolean(e.TOSS_CLIENT_KEY && e.TOSS_SECRET_KEY);
}
