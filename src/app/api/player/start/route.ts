import { NextResponse } from "next/server";
import { userFromRequest } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { startPlayback } from "@/server/player";
import { startBody } from "../schema";

export const dynamic = "force-dynamic";

/** 재생 시작: 기기 등록(2대까지)과 재생 소유권. 이어보기 위치를 돌려준다. */
export const POST = route(async (req) => {
  const user = await userFromRequest(req);
  const body = await readJson(req, startBody);
  const r = await startPlayback(user?.id ?? null, body, new Date(), req.headers.get("user-agent"));
  return NextResponse.json(r);
});
