import type { LectureUse } from "@/rules/refund";
import { db } from "./db";

/**
 * 환불 계산용 강별 사용량 (강의 여러 개면 모든 강을 합친다: 패키지).
 * 진도 행이 없으면 0초. 진도는 Task 11(하트비트)이 채운다.
 */
export async function usageFor(userId: string, courseIds: string[]): Promise<LectureUse[]> {
  if (!courseIds.length) return [];
  const lectures = await db.lecture.findMany({
    where: { course_id: { in: courseIds } },
    select: { id: true, duration_sec: true },
    orderBy: [{ course_id: "asc" }, { sort: "asc" }],
  });
  const progress = await db.lectureProgress.findMany({
    where: { user_id: userId, lecture_id: { in: lectures.map((l) => l.id) } },
    select: { lecture_id: true, watched_sec: true, downloaded_at: true },
  });
  const by = new Map(progress.map((p) => [p.lecture_id, p]));
  return lectures.map((l) => {
    const p = by.get(l.id);
    return { duration_sec: l.duration_sec, watched_sec: p?.watched_sec ?? 0, downloaded: !!p?.downloaded_at };
  });
}
