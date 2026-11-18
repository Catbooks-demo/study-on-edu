import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getEnv, tossEnabled } from "@/server/env";
import { clientIp, readJson, route } from "@/server/http";
import { enforceCheckoutLimit } from "@/server/orders";
import { currentSubscription, invoiceView, payFirstInvoiceMock, subscribe, subscriptionView } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

const body = z.object({
  plan_code: z.string().min(1).max(40),
  card_last4: z.string().regex(/^\d{4}$/, "카드 끝 4자리를 숫자 4개로 적어 주세요."),
});

/** 내 구독 (없으면 null). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const s = await currentSubscription(user.id);
  return NextResponse.json({ subscription: s ? { ...subscriptionView(s), invoices: s.invoices.map(invoiceView) } : null });
}, { feature: "browse" });

/**
 * 구독 신청. 토스 키가 있으면 결제창 정보(pay)를 돌려주고, 없으면 모의 정기 결제로 바로 낸다(끝 4000 카드는 402).
 * 이미 구독 중이면 409 ALREADY_SUBSCRIBED.
 */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  enforceCheckoutLimit(user.id, clientIp(req));
  const { plan_code, card_last4 } = await readJson(req, body);
  const r = await subscribe(user.id, plan_code, { card_last4 });
  const toss = tossEnabled();
  if (!toss) await payFirstInvoiceMock(r.invoice.id);
  const sub = await db.subscription.findUniqueOrThrow({ where: { id: r.subscription.id }, include: { plan: true } });
  const inv = await db.subscriptionInvoice.findUniqueOrThrow({ where: { id: r.invoice.id } });
  return NextResponse.json(
    {
      subscription: subscriptionView(sub),
      invoice: invoiceView(inv),
      pay: toss ? { ...r.pay, clientKey: getEnv().TOSS_CLIENT_KEY, customerName: user.name, customerEmail: user.email } : null,
    },
    { status: 201 },
  );
}, { feature: "write" });
