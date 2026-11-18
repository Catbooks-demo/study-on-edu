import { NextResponse } from "next/server";
import { z } from "zod";
import { LIMITS, enforceLimit } from "@/server/auth/ratelimit";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { previewSubscriptionRefund, refundView, requestSubscriptionRefund } from "@/server/refunds";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({
  reason: z.string().trim().min(2, "환불 사유를 두 글자 이상 적어 주세요.").max(500, "사유는 500자까지 적을 수 있어요."),
});

/** 구독 환불 미리 보기 (예상 환불액과 계산 근거). */
export const GET = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  return NextResponse.json({ quote: await previewSubscriptionRefund(user.id, id) });
});

/** 구독 환불 신청. 승인되면 그 기간 결제를 돌려주고 구독은 바로 끝난다. */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  enforceLimit(`refund:user:${user.id}`, ...LIMITS.write);
  const { id } = await params;
  const { reason } = await readJson(req, body);
  const r = await requestSubscriptionRefund(user.id, id, reason);
  return NextResponse.json({ refund: refundView(r) }, { status: 201 });
});
