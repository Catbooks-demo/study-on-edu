import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { HttpError, clientIp, readJson, route } from "@/server/http";
import { enforceCheckoutLimit } from "@/server/orders";
import { confirmPayment } from "@/server/payments";

export const dynamic = "force-dynamic";

const body = z.object({ orderId: z.string().min(1).max(80), paymentKey: z.string().min(1).max(200), amount: z.number().int().positive() });

/** 토스 결제 성공 화면이 부르는 승인. 본인 주문·청구만. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  enforceCheckoutLimit(user.id, clientIp(req));
  const p = await readJson(req, body);
  const pay = await db.payment.findUnique({
    where: { toss_order_id: p.orderId },
    include: { order: true, invoice: { include: { subscription: true } } },
  });
  const owner = pay?.order?.user_id ?? pay?.invoice?.subscription.user_id;
  if (!pay || owner !== user.id) throw new HttpError(404, "NOT_FOUND", "결제 정보를 찾지 못했어요.");
  const r = await confirmPayment(p);
  return NextResponse.json({
    order: r.order ? { code: r.order.code, status: r.order.status } : null,
    invoice: r.invoice ? { id: r.invoice.id, status: r.invoice.status } : null,
  });
}, { feature: "write" });
