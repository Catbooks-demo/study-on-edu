import { NextResponse } from "next/server";
import { authApiKey, canSeePii } from "@/server/apikeys";
import { db } from "@/server/db";
import { HttpError, route } from "@/server/http";
import { ORDER_ITEM_REFUNDS, orderV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

/** 주문 하나 (주문번호). */
export const GET = route<Ctx>(async (req, { params }) => {
  const key = await authApiKey(req, "read");
  const { code } = await params;
  const o = await db.order.findUnique({
    where: { code },
    include: { user: true, coupon: true, items: { include: { course: true, bundle: true, refunds: ORDER_ITEM_REFUNDS }, orderBy: { created_at: "asc" } } },
  });
  if (!o) throw new HttpError(404, "NOT_FOUND", "주문을 찾지 못했어요.");
  return NextResponse.json({ data: orderV1(o, canSeePii(key)) });
});
