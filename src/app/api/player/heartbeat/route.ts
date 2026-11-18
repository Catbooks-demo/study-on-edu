import { NextResponse } from "next/server";
import { userFromRequest } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { heartbeat } from "@/server/player";
import { heartbeatBody } from "../schema";

export const dynamic = "force-dynamic";

/** 하트비트 (주기마다, 일시정지·끝·창 닫기 때는 sendBeacon). 다른 기기가 시작했으면 409 PLAYING_ELSEWHERE. */
export const POST = route(async (req) => {
  const user = await userFromRequest(req);
  const body = await readJson(req, heartbeatBody);
  return NextResponse.json(await heartbeat(user?.id ?? null, body));
});
