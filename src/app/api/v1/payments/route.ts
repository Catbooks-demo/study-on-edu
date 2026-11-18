import { NextResponse } from "next/server";
import { authApiKey } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";
import { paymentV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

/** 결제·환불 결제 목록 (kind: charge, refund). `?updated_since&cursor&limit` → `{data, next_cursor}` (updated_at, id 오름차순). */
export const GET = route(async (req) => {
  await authApiKey(req, "read");
  const p = readPage(req);
  const rows = await db.payment.findMany({ where: { ...pageWhere(p) }, orderBy: pageOrder, take: p.limit, include: { order: true } });
  return NextResponse.json(pageResult(rows, p, (r) => paymentV1(r)));
});
