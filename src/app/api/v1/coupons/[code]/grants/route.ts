import { NextResponse } from "next/server";
import { z } from "zod";
import { apiActor, authApiKey } from "@/server/apikeys";
import { audit } from "@/server/audit";
import { grantCoupon } from "@/server/couponbox";
import { route, readJson } from "@/server/http";
import { INBOX_BATCH_MAX, INBOX_BODY_MAX, INBOX_TITLE_MAX } from "@/server/inbox";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

const body = z.object({
  member_ids: z.array(z.string().min(1).max(40)).min(1, "받을 회원을 적어 주세요.").max(INBOX_BATCH_MAX, `회원은 한 번에 ${INBOX_BATCH_MAX}명까지예요.`),
  message: z
    .object({ title: z.string().trim().max(INBOX_TITLE_MAX).optional(), body: z.string().trim().max(INBOX_BODY_MAX).optional() })
    .optional(),
});

/**
 * 회원 쿠폰함에 쿠폰 넣기 (write, 멱등). 회원은 member_id(v1 응답의 회원 id).
 * 새로 받은 회원마다 메시지함에 안내가 하나 들어간다(message로 제목·내용을 바꿀 수 있다).
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const key = await authApiKey(req, "write");
  const { code } = await params;
  const b = await readJson(req, body);
  const r = await grantCoupon(code, b.member_ids, "api", b.message ?? {});
  await audit(apiActor(key), "coupon.grant", `coupon:${r.coupon.id}`, {
    code: r.coupon.code,
    granted: r.granted.length,
    already: r.already.length,
    not_found: r.not_found.length,
  });
  return NextResponse.json({ coupon: { code: r.coupon.code, private: r.coupon.private }, granted: r.granted, already: r.already, not_found: r.not_found });
});
