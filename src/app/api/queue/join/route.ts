import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceLimit } from "@/server/auth/ratelimit";
import { clientIp, readJson, route } from "@/server/http";
import { admitCookies, join, ticketView } from "@/server/queue";
import { withQueueCookies } from "@/server/queue-http";

export const dynamic = "force-dynamic";

const body = z.object({ target: z.string().max(60) });

/** 줄 서기. 바로 입장되면 입장 쿠키(so_q_<대상>, HttpOnly, 10분)를 붙인다. 꺼진 대상이면 409 QUEUE_OFF. */
export const POST = route(async (req) => {
  const { target } = await readJson(req, body);
  enforceLimit(`queue:ip:${clientIp(req)}`, 30, 60);
  const now = new Date();
  const t = await join(target, now);
  const v = await ticketView(t, now);
  return withQueueCookies(NextResponse.json(v), v.status === "admitted" ? admitCookies(req, t, now) : undefined);
});
