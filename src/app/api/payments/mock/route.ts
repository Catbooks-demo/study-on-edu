import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { clientIp, readJson, route } from "@/server/http";
import { enforceCheckoutLimit, getOrderForUser } from "@/server/orders";
import { mockPay } from "@/server/payments";

export const dynamic = "force-dynamic";

const body = z.object({ code: z.string().min(1).max(40) });

/** 모의 결제 (토스 키가 없을 때만). 본인 주문만. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  enforceCheckoutLimit(user.id, clientIp(req));
  const { code } = await readJson(req, body);
  const order = await getOrderForUser(user.id, code);
  const paid = await mockPay(order.code);
  return NextResponse.json({ order: { code: paid.code, status: paid.status } });
});
