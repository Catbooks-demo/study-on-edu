import { NextResponse } from "next/server";
import { requireStaff } from "@/server/auth/session";
import { route } from "@/server/http";
import { retryInvoiceNow, subscriptionView } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 결제가 밀린 구독을 지금 다시 결제 (권한 subscriptions). */
export const POST = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "subscriptions");
  const { id } = await params;
  const s = await retryInvoiceNow(`staff:${staff.id}`, id);
  return NextResponse.json({ subscription: subscriptionView(s) });
});
