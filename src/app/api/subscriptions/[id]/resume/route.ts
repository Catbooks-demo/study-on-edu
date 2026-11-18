import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { resume, subscriptionView } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 일시정지 일찍 풀기 (남은 온전한 날만큼 기간이 당겨진다). */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const s = await resume(user.id, id);
  return NextResponse.json({ subscription: subscriptionView(s) });
});
