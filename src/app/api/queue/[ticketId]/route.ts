import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { admitCookies, poll } from "@/server/queue";
import { withQueueCookies } from "@/server/queue-http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ticketId: string }> };

/** 내 차례 확인 (3초마다). 입장이 허용되면 입장 쿠키를 붙인다. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { ticketId } = await params;
  const now = new Date();
  const v = await poll(ticketId, now);
  const res = NextResponse.json(v);
  if (v.status !== "admitted") return res;
  const t = await db.queueTicket.findUniqueOrThrow({ where: { id: ticketId } });
  return withQueueCookies(res, admitCookies(req, t, now));
});
