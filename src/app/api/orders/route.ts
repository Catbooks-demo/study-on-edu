import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { clientIp, readJson, route } from "@/server/http";
import { createOrder, enforceCheckoutLimit } from "@/server/orders";
import { type CookieSpec, cartCourseCodes, checkoutTargetsFor, gate, heldIssuedAt, queueWaitResponse } from "@/server/queue";
import { withQueueCookies } from "@/server/queue-http";

export const dynamic = "force-dynamic";

// price_at·held_at은 받지 않는다(가격 시각은 서버가 정한다).
const body = z.object({ coupon_code: z.string().trim().max(40).nullish() });

/**
 * 장바구니로 주문 만들기. 결제 전 주문은 30분 동안 살아 있다.
 * 결제 캠페인 대기열이 켜져 있고 장바구니 강의가 대상이면 입장 쿠키가 있어야 한다(없으면 409 QUEUE_WAIT + 순번표).
 * 할인 마감 전에 받은 순번표면 마감 뒤 30분까지 그 시각 가격으로 주문된다.
 */
export const POST = route(
  async (req) => {
    const user = await requireUser(req);
    enforceCheckoutLimit(user.id, clientIp(req));
    const { coupon_code } = await readJson(req, body);
    const now = new Date();
    const targets = await checkoutTargetsFor(await cartCourseCodes(user.id));
    const cookies: CookieSpec[] = [];
    let heldAt: Date | undefined;
    for (const t of targets) {
      const g = await gate(req, t, now);
      if (!g.pass) return queueWaitResponse(g.ticket_id, t);
      cookies.push(...(g.cookies ?? []));
      const held = (await heldIssuedAt(req, t, now)) ?? (g.ticket_id ? now : null);
      if (held && (!heldAt || held < heldAt)) heldAt = held;
    }
    const order = await createOrder(user.id, { coupon_code: coupon_code || null, held_at: heldAt }, now);
    const res = NextResponse.json(
      { order: { code: order.code, payable: order.payable, expires_at: order.expires_at.toISOString() } },
      { status: 201 },
    );
    return withQueueCookies(res, cookies);
  },
  { feature: "write" },
);
