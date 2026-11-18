import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { getEnv, tossEnabled } from "@/server/env";
import { HttpError, clientIp, readJson, route } from "@/server/http";
import { enforceCheckoutLimit, getOrderForUser } from "@/server/orders";
import { preparePayment } from "@/server/payments";

export const dynamic = "force-dynamic";

const body = z.object({ code: z.string().min(1).max(40) });

/** 토스 결제 준비. 토스 키가 없으면 400(모의 결제를 쓰라는 뜻). */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  enforceCheckoutLimit(user.id, clientIp(req));
  const { code } = await readJson(req, body);
  const order = await getOrderForUser(user.id, code);
  if (!tossEnabled()) throw new HttpError(400, "TOSS_DISABLED", "토스 테스트 결제가 꺼져 있어요. 모의 결제를 써 주세요.");
  const p = await preparePayment(order.code, "toss");
  return NextResponse.json({ ...p, clientKey: getEnv().TOSS_CLIENT_KEY, customerName: user.name, customerEmail: user.email });
}, { feature: "write" });
