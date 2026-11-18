import { NextResponse } from "next/server";
import { authApiKey } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";
import { courseV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

/** 강의 목록. `?updated_since&cursor&limit` → `{data, next_cursor}` (updated_at, id 오름차순). */
export const GET = route(async (req) => {
  await authApiKey(req, "read");
  const p = readPage(req);
  const rows = await db.course.findMany({ where: { ...pageWhere(p) }, orderBy: pageOrder, take: p.limit, include: { category: true, instructor: true } });
  return NextResponse.json(pageResult(rows, p, (r) => courseV1(r)));
});
