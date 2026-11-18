import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { undoCancel, subscriptionView } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 해지 예약 취소. */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const s = await undoCancel(user.id, id);
  return NextResponse.json({ subscription: subscriptionView(s) });
});
