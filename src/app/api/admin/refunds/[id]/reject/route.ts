import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { refundView, rejectRefund } from "@/server/refunds";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ reason: z.string().trim().min(1, "거절 사유를 적어 주세요.").max(500) });

/** 환불 거절 (권한 refunds, 사유 필수). */
export const POST = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "refunds");
  const { id } = await params;
  const { reason } = await readJson(req, body);
  return NextResponse.json({ refund: refundView(await rejectRefund(id, staff.id, reason)) });
});
