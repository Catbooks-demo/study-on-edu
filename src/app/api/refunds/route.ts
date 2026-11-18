import { NextResponse } from "next/server";
import { z } from "zod";
import { LIMITS, enforceLimit } from "@/server/auth/ratelimit";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { refundView, requestRefund } from "@/server/refunds";

export const dynamic = "force-dynamic";

const body = z.object({
  order_item_id: z.string().min(1).max(40),
  reason: z.string().trim().min(2, "환불 사유를 두 글자 이상 적어 주세요.").max(500, "사유는 500자까지 적을 수 있어요."),
});

/** 환불 신청 (본인 주문 항목). 이미 열린 신청이 있으면 409 REFUND_OPEN. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  enforceLimit(`refund:user:${user.id}`, ...LIMITS.write);
  const { order_item_id, reason } = await readJson(req, body);
  const r = await requestRefund(user.id, order_item_id, reason);
  return NextResponse.json({ refund: refundView(r) }, { status: 201 });
}, { feature: "write" });
