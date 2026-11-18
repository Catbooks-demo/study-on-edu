import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { HttpError, route } from "@/server/http";
import { previewRefund } from "@/server/refunds";

export const dynamic = "force-dynamic";

/** 환불 미리 보기: ?item=<주문 항목 id>. 경과일·진도·공제 근거와 예상 환불액. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const item = new URL(req.url).searchParams.get("item");
  if (!item || item.length > 40) throw new HttpError(400, "BAD_INPUT", "주문 항목을 골라 주세요.");
  return NextResponse.json({ quote: await previewRefund(user.id, item) });
});
