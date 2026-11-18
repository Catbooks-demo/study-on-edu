import { NextResponse } from "next/server";
import { authApiKey, canSeePii } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";
import { subscriptionV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

/** 구독 목록. 결제가 한 번도 안 된 구독(expired로 저장됨)은 뺀다. `?updated_since&cursor&limit` → `{data, next_cursor}` (updated_at, id 오름차순). */
export const GET = route(async (req) => {
  const key = await authApiKey(req, "read");
  const p = readPage(req);
  const rows = await db.subscription.findMany({ where: { ...pageWhere(p), invoices: { some: { status: { in: ["paid", "refunded"] } } } }, orderBy: pageOrder, take: p.limit, include: { user: true, plan: true } });
  const pii = canSeePii(key);
  return NextResponse.json(pageResult(rows, p, (r) => subscriptionV1(r, pii)));
});
