import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { changeCard, subscriptionView } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ card_last4: z.string().regex(/^\d{4}$/, "카드 끝 4자리를 숫자 4개로 적어 주세요.") });

/** 결제 카드 바꾸기 (모의 카드 끝 4자리). 결제가 밀려 있으면 바로 다시 결제한다. */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const { card_last4 } = await readJson(req, body);
  const s = await changeCard(user.id, id, card_last4);
  return NextResponse.json({ subscription: subscriptionView(s) });
});
