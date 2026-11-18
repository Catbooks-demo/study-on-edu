/**
 * 진도 규칙 (DB를 모르는 순수 함수).
 * 구간은 영상 시간(초) 기준 [시작, 끝) 정수다. 같은 구간을 다시 보면 한 번만 센다.
 */
export type Range = [number, number];

/** 강 하나를 90% 이상 보면 완료. */
export const LECTURE_DONE_RATIO = 0.9;
/** 강의 진도율(완료한 강 길이 기준) 80% 이상이면 완강 → 수료증. */
export const COURSE_COMPLETE_RATIO = 0.8;
/** 진도율 40%부터 후기를 쓸 수 있다. */
export const REVIEW_MIN_RATIO = 0.4;
/** 받는 배속. 밖이면 위조로 보고 거절한다. */
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
/** 하트비트 허용 여유: 실제 흐른 시간 × 배속 × factor + sec. */
export const HEARTBEAT_SLACK = { factor: 1.2, sec: 5 } as const;

/** 겹치거나 맞닿은 구간을 합친다. 빈 구간은 버린다. 입력은 바꾸지 않는다. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges
    .filter(([s, e]) => e > s)
    .map(([s, e]): Range => [s, e])
    .sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e); // 겹치거나 맞닿으면 합친다
    else out.push([s, e]);
  }
  return out;
}

const total = (ranges: Range[]) => ranges.reduce((a, [s, e]) => a + (e - s), 0);

/**
 * 본 구간에 seg를 더한다. seg는 [0, duration]으로 자르고(시작·끝 모두 내림) 합친다.
 * added_sec = 새 watched − 이전 watched (≥ 0). 이 값만 watch_events.added_sec에 쓴다.
 */
export function addWatched(existing: Range[], seg: Range, duration_sec: number): { ranges: Range[]; watched_sec: number; added_sec: number } {
  const before = mergeRanges(existing);
  const prev = total(before);
  const dur = Math.max(0, Math.floor(duration_sec));
  const s = Math.min(dur, Math.max(0, Math.floor(seg[0])));
  const e = Math.min(dur, Math.max(0, Math.floor(seg[1])));
  const ranges = e > s ? mergeRanges([...before, [s, e]]) : before;
  const watched_sec = total(ranges);
  return { ranges, watched_sec, added_sec: Math.max(0, watched_sec - prev) };
}

/** 배속이 받는 값인지. */
export function isAllowedRate(rate: number): boolean {
  return (RATES as readonly number[]).includes(rate);
}

/**
 * 하트비트가 보낸 구간 중 실제로 볼 수 있었던 만큼만 받는다.
 * 허용 길이 = (지난 하트비트부터 흐른 초, 첫 하트비트면 heartbeat_sec) × rate × 1.2 + 5.
 * 넘는 부분은 잘라 [s, s+허용]으로 한다. 배속이 RATES 밖이면 null(호출한 쪽이 400). s ≥ e면 null.
 */
export function acceptSegment(seg: Range, rate: number, last_beat_at: Date | null, now: Date, heartbeat_sec: number): Range | null {
  if (!isAllowedRate(rate)) return null;
  const [s, e] = seg;
  if (!(e > s)) return null;
  const elapsed = last_beat_at ? Math.max(0, (now.getTime() - last_beat_at.getTime()) / 1000) : heartbeat_sec;
  const allowed = elapsed * rate * HEARTBEAT_SLACK.factor + HEARTBEAT_SLACK.sec;
  return [s, Math.min(e, s + allowed)];
}

/** 강 완료: 본 초 ≥ 90% × 길이. */
export function lectureDone(watched_sec: number, duration_sec: number): boolean {
  return watched_sec >= LECTURE_DONE_RATIO * duration_sec;
}

/** 강의 진도율 = 완료한 강 길이 합 ÷ 전체 길이 (0..1). */
export function courseProgress(lectures: { duration_sec: number; done: boolean }[]): number {
  const all = lectures.reduce((a, l) => a + l.duration_sec, 0);
  if (all <= 0) return 0;
  const done = lectures.reduce((a, l) => a + (l.done ? l.duration_sec : 0), 0);
  return done / all;
}

export function isCompleted(ratio: number): boolean {
  return ratio >= COURSE_COMPLETE_RATIO;
}

export function canReview(ratio: number): boolean {
  return ratio >= REVIEW_MIN_RATIO;
}
