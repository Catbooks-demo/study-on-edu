/**
 * 지표 저장소 (앱 하나의 메모리). 다른 모듈을 가져오지 않아서 db.ts도 순환 없이 쓸 수 있다.
 * 읽기·내보내기는 metrics.ts가 한다.
 */
export const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

export interface Histogram {
  counts: number[]; // BUCKETS 칸마다 (누적 아님) + 마지막 칸 = +Inf
  sum: number;
  count: number;
}

/** 1초(최근 창)·1분(그래프) 칸. ms는 p95 계산용 표본(칸마다 상한). */
export interface Slot {
  key: number;
  n: number;
  err: number;
  ms: number[];
}

export interface MetricsState {
  requests: Map<string, number>; // `${group}\t${method}\t${status}`
  durations: Map<string, Histogram>; // group
  payments: Map<string, { attempts: number; failures: number }>;
  jobs: Map<string, number>; // 마지막 소요 초
  queueAdmitted: Map<string, number>;
  slowQueries: number;
  seconds: Slot[]; // 60칸
  minutes: Slot[]; // 60칸
}

export const SAMPLE_CAP = 2000;

const g = globalThis as unknown as { __studyonMetrics?: MetricsState };

function fresh(): MetricsState {
  return {
    requests: new Map(),
    durations: new Map(),
    payments: new Map(),
    jobs: new Map(),
    queueAdmitted: new Map(),
    slowQueries: 0,
    seconds: [],
    minutes: [],
  };
}

export function metricsState(): MetricsState {
  if (!g.__studyonMetrics) g.__studyonMetrics = fresh();
  return g.__studyonMetrics;
}

export function resetMetricsState(): void {
  g.__studyonMetrics = fresh();
}

/** 느린 쿼리 하나 (Prisma 쿼리 이벤트 500ms 이상, 또는 장애 주입의 DB 지연). */
export function bumpSlowQuery(): void {
  metricsState().slowQueries++;
}
