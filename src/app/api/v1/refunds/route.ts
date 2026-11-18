import { NextResponse } from "next/server";
import { authApiKey } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";
import { refundV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

const statusFilter = (req: Request) => {
  const s = new URL(req.url).searchParams.get("status");
  return s ? { status: s.slice(0, 30) } : {};
};

/** 환불 요청 목록 (status: requested, approved, rejected, done). `?updated_since&cursor&limit` → `{data, next_cursor}` (updated_at, id 오름차순). */
export const GET = route(async (req) => {
  await authApiKey(req, "read");
  const p = readPage(req);
  const rows = await db.refund.findMany({ where: { ...pageWhere(p), ...statusFilter(req) }, orderBy: pageOrder, take: p.limit, include: { order_item: { include: { order: true } } } });
  return NextResponse.json(pageResult(rows, p, (r) => refundV1(r)));
});
