import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { DEVICE_COOKIE, deviceView, listDevices } from "@/server/devices";
import { readCookie, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** 내 등록 기기 (최대 2대). 지금 쓰는 기기는 current. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const key = readCookie(req, DEVICE_COOKIE);
  return NextResponse.json({ devices: (await listDevices(user.id)).map((d) => deviceView(d, key)) });
});
