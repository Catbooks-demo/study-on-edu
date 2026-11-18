import { NextResponse } from "next/server";
import { authApiKey, canSeePii } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";
import { inquiryV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

const statusFilter = (req: Request) => {
  const s = new URL(req.url).searchParams.get("status");
  return s ? { status: s.slice(0, 30) } : {};
};

/** 1:1 문의 목록 (status: open, answered). `?updated_since&cursor&limit` → `{data, next_cursor}` (updated_at, id 오름차순). */
export const GET = route(async (req) => {
  const key = await authApiKey(req, "read");
  const p = readPage(req);
  const rows = await db.inquiry.findMany({ where: { ...pageWhere(p), ...statusFilter(req) }, orderBy: pageOrder, take: p.limit, include: { user: true } });
  const pii = canSeePii(key);
  return NextResponse.json(pageResult(rows, p, (r) => inquiryV1(r, pii)));
});
