/** 되채우기 → 매일 모드로 넘기는 상태 파일 (--out/daily_state.json). */
import type { DayStats, Ev, Extra } from "./engine";

export interface DayState {
  /** 이 날 결제 계획 중 다음에 넣을 번호 (시각 순). */
  next: number;
  total: number;
  finalized: boolean;
  stats: DayStats;
}

export interface DailyState {
  version: 1;
  seed: number;
  windowStart: string;
  windowEnd: string;
  cutoff: number;
  members: number;
  newMembers: number;
  staffId: string;
  days: Record<string, DayState>;
  queue: Ev[];
  extra: Extra;
  /** 넣던 중인 결제 (다시 켜면 실제로 들어갔는지 확인). */
  inflight: { key: string; at: number } | null;
  /** traffic.jsonl을 쓴 마지막 날. */
  trafficThrough: string;
  updatedAt: string;
}
