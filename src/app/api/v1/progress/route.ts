import { NextResponse } from "next/server";
import { isCompleted } from "@/rules/progress";
import { authApiKey } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { courseProgressFor } from "@/server/player";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";

export const dynamic = "force-dynamic";

/**
 * 진도 요약: 수강권마다 `{enrollment_id, course_code, member_id, progress_ratio, completed, last_watched_at}`.
 * 쪽 나누기는 수강권(enrollments)의 updated_at·id 기준이고, 진도 값은 읽는 지금의 값이다.
 */
export const GET = route(async (req) => {
  await authApiKey(req, "read");
  const p = readPage(req);
  const rows = await db.enrollment.findMany({ where: pageWhere(p), orderBy: pageOrder, take: p.limit, include: { course: { select: { code: true } } } });
  const data = await Promise.all(
    rows.map(async (e) => {
      const [prog, last] = await Promise.all([
        courseProgressFor(db, e.user_id, e.course_id),
        db.lectureProgress.aggregate({ where: { user_id: e.user_id, course_id: e.course_id }, _max: { last_watched_at: true } }),
      ]);
      return {
        enrollment_id: e.id,
        course_code: e.course.code,
        member_id: e.user_id,
        status: e.status,
        progress_ratio: Math.round(prog.ratio * 10_000) / 10_000,
        completed: isCompleted(prog.ratio),
        last_watched_at: last._max.last_watched_at?.toISOString() ?? null,
        updated_at: e.updated_at,
        id: e.id,
      };
    }),
  );
  const page = pageResult(data, p, ({ updated_at, id, ...rest }) => {
    void updated_at;
    void id;
    return rest;
  });
  return NextResponse.json(page);
});
