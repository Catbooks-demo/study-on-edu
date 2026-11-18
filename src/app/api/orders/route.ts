import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { clientIp, readJson, route } from "@/server/http";
import { createOrder, enforceCheckoutLimit } from "@/server/orders";

export const dynamic = "force-dynamic";

// price_at은 받지 않는다(가격 시각은 서버가 정한다).
const body = z.object({ coupon_code: z.string().trim().max(40).nullish() });

/** 장바구니로 주문 만들기. 결제 전 주문은 30분 동안 살아 있다. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  enforceCheckoutLimit(user.id, clientIp(req));
  const { coupon_code } = await readJson(req, body);
  const order = await createOrder(user.id, { coupon_code: coupon_code || null });
  return NextResponse.json({ order: { code: order.code, payable: order.payable, expires_at: order.expires_at.toISOString() } }, { status: 201 });
}, { feature: "write" });
