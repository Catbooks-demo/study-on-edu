import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { cancelAtPeriodEnd, subscriptionView } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 해지 예약 (기간 끝까지 듣고 그 뒤 결제하지 않는다). */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const s = await cancelAtPeriodEnd(user.id, id);
  return NextResponse.json({ subscription: subscriptionView(s) });
});
