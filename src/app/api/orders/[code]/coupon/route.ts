import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { clientIp, readJson, route } from "@/server/http";
import { applyOrderCoupon, enforceCheckoutLimit, getOrderForUser, orderView } from "@/server/orders";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

const body = z.object({ coupon_code: z.string().trim().max(40).nullable() });

/** 주문서에서 쿠폰 넣기·빼기 ({coupon_code: null}이면 빼기). */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  enforceCheckoutLimit(user.id, clientIp(req));
  const { code } = await params;
  const { coupon_code } = await readJson(req, body);
  await applyOrderCoupon(user.id, code, coupon_code || null);
  return NextResponse.json({ order: orderView(await getOrderForUser(user.id, code)) });
}, { feature: "write" });
