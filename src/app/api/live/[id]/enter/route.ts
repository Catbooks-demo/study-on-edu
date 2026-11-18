import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { enterLive } from "@/server/live";
import { gate, queueWaitResponse } from "@/server/queue";
import { withQueueCookies } from "@/server/queue-http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 라이브 입장 (시작 10분 전부터). 방 주소를 돌려준다.
 * 라이브 대기열(live:<id>)이 켜져 있으면 입장 쿠키가 있어야 한다 (없으면 409 QUEUE_WAIT + 순번표).
 */
export const POST = route<Ctx>(
  async (req, { params }) => {
    const user = await requireUser(req);
    const { id } = await params;
    const now = new Date();
    const g = /^[A-Za-z0-9_-]{1,40}$/.test(id) ? await gate(req, `live:${id}`, now) : { pass: true as const };
    if (!g.pass) return queueWaitResponse(g.ticket_id, `live:${id}`);
    const res = NextResponse.json(await enterLive(user.id, id, now));
    return withQueueCookies(res, g.cookies);
  },
  { feature: "play" },
);
