import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { approveRefund, refundView } from "@/server/refunds";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({
  amount: z.number().int().min(0).optional(),
  reason: z.string().trim().max(500).optional(),
});

/** 환불 승인 (권한 refunds). 금액을 바꾸면 reason 필수. 결제사 실패면 approved로 남고 작업이 다시 시도한다. */
export const POST = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "refunds");
  const { id } = await params;
  const opts = await readJson(req, body);
  const r = await approveRefund(id, staff.id, opts);
  return NextResponse.json({ refund: refundView(r) });
});
