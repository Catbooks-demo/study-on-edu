import { describe, expect, it } from "vitest";
import {
  COURSE_COMPLETE_RATIO,
  HEARTBEAT_SLACK,
  LECTURE_DONE_RATIO,
  RATES,
  REVIEW_MIN_RATIO,
  acceptSegment,
  addWatched,
  canReview,
  courseProgress,
  isCompleted,
  lectureDone,
  mergeRanges,
} from "@/rules/progress";

const NOW = new Date("2026-11-18T03:00:00Z");
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);

describe("상수", () => {
  it("values", () => {
    expect(LECTURE_DONE_RATIO).toBe(0.9);
    expect(COURSE_COMPLETE_RATIO).toBe(0.8);
    expect(REVIEW_MIN_RATIO).toBe(0.4);
    expect(RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(HEARTBEAT_SLACK).toEqual({ factor: 1.2, sec: 5 });
  });
});

describe("구간 합치기", () => {
  it("merge overlap", () => {
    expect(mergeRanges([[0, 30], [20, 50], [60, 90]])).toEqual([[0, 50], [60, 90]]);
  });

  it("merge touching", () => {
    expect(mergeRanges([[0, 30], [30, 60]])).toEqual([[0, 60]]);
  });

  it("drops empty", () => {
    expect(mergeRanges([[5, 5]])).toEqual([]);
  });

  it("unsorted input", () => {
    expect(mergeRanges([[60, 90], [0, 10], [5, 20]])).toEqual([[0, 20], [60, 90]]);
  });

  it("does not mutate input", () => {
    const input: [number, number][] = [[0, 30], [20, 50]];
    mergeRanges(input);
    expect(input).toEqual([[0, 30], [20, 50]]);
  });

  it("rewatch counts once", () => {
    const r = addWatched([[0, 60]], [0, 60], 600);
    expect(r.added_sec).toBe(0);
    expect(r.watched_sec).toBe(60);
    expect(r.ranges).toEqual([[0, 60]]);
  });

  it("out of order", () => {
    const first = addWatched([], [60, 90], 600);
    expect(first.added_sec).toBe(30);
    const r = addWatched(first.ranges, [30, 60], 600);
    expect(r.ranges).toEqual([[30, 90]]);
    expect(r.added_sec).toBe(30);
    expect(r.watched_sec).toBe(60);
  });

  it("clamp to duration", () => {
    const r = addWatched([], [90, 130], 100);
    expect(r.ranges).toEqual([[90, 100]]);
    expect(r.added_sec).toBe(10);
    expect(r.watched_sec).toBe(10);
  });

  it("negative start clamps to 0, fractional seconds floor", () => {
    const r = addWatched([], [-5.7, 10.9], 100);
    expect(r.ranges).toEqual([[0, 10]]);
    expect(r.added_sec).toBe(10);
  });

  it("segment fully past duration adds nothing", () => {
    const r = addWatched([[0, 10]], [120, 150], 100);
    expect(r.ranges).toEqual([[0, 10]]);
    expect(r.added_sec).toBe(0);
    expect(r.watched_sec).toBe(10);
  });
});

describe("하트비트 구간 받기", () => {
  it("speed counts video time", () => {
    expect(acceptSegment([0, 60], 2, ago(30), NOW, 30)).toEqual([0, 60]);
  });

  it("skip-ahead truncated", () => {
    // 30 × 1 × 1.2 + 5 = 41
    expect(acceptSegment([0, 600], 1, ago(30), NOW, 30)).toEqual([0, 41]);
  });

  it("first beat uses heartbeat_sec", () => {
    expect(acceptSegment([100, 1000], 1, null, NOW, 30)).toEqual([100, 141]);
  });

  it("forged rate 3 rejected", () => {
    expect(acceptSegment([0, 60], 3, ago(30), NOW, 30)).toBeNull();
  });

  it("empty or reversed segment is null", () => {
    expect(acceptSegment([50, 50], 1, ago(30), NOW, 30)).toBeNull();
    expect(acceptSegment([60, 30], 1, ago(30), NOW, 30)).toBeNull();
  });

  it("clock going backwards does not allow more than slack", () => {
    // last_beat_at가 미래면 경과 0초 → 허용 5초
    expect(acceptSegment([0, 100], 1, new Date(NOW.getTime() + 10_000), NOW, 30)).toEqual([0, 5]);
  });
});

describe("완료 판정", () => {
  it("lecture done at 90%", () => {
    expect(lectureDone(539, 600)).toBe(false);
    expect(lectureDone(540, 600)).toBe(true);
  });

  it("course progress by done length", () => {
    const ratio = courseProgress([
      { duration_sec: 600, done: true },
      { duration_sec: 300, done: false },
      { duration_sec: 100, done: true },
    ]);
    expect(ratio).toBe(0.7);
    expect(isCompleted(0.7)).toBe(false);
    expect(isCompleted(0.8)).toBe(true);
  });

  it("empty course progress is 0", () => {
    expect(courseProgress([])).toBe(0);
  });

  it("canReview", () => {
    expect(canReview(0.39)).toBe(false);
    expect(canReview(0.4)).toBe(true);
  });
});
