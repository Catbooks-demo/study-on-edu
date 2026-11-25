import { NextResponse } from "next/server";
import { authApiKey, canSeePii } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";
import { ORDER_ITEM_REFUNDS, orderV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

const statusFilter = (req: Request) => {
  const s = new URL(req.url).searchParams.get("status");
  return s ? { status: s.slice(0, 30) } : {};
};

/** 주문 목록. `?status=`로 좁힌다. `?updated_since&cursor&limit` → `{data, next_cursor}` (updated_at, id 오름차순). */
export const GET = route(async (req) => {
  const key = await authApiKey(req, "read");
  const p = readPage(req);
  const rows = await db.order.findMany({ where: { ...pageWhere(p), ...statusFilter(req) }, orderBy: pageOrder, take: p.limit, include: { user: true, coupon: true, items: { include: { course: true, bundle: true, refunds: ORDER_ITEM_REFUNDS }, orderBy: { created_at: "asc" } } } });
  const pii = canSeePii(key);
  return NextResponse.json(pageResult(rows, p, (r) => orderV1(r, pii)));
});
