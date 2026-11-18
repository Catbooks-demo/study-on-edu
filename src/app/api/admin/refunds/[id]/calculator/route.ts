import { NextResponse } from "next/server";
import { refundCalculator } from "@/server/admin";
import { requireStaff } from "@/server/auth/session";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 환불 계산기 (권한 refunds): 진도 방식·경과일 방식·실제 적용을 지금 시각으로. */
export const GET = route<Ctx>(async (req, { params }) => {
  await requireStaff(req, "refunds");
  const { id } = await params;
  return NextResponse.json({ calculator: await refundCalculator(id) });
});
