import { NextResponse } from "next/server";
import { STAFF_COOKIE, cookieOptions, revokeStaffSession } from "@/server/auth/session";
import { readCookie, route } from "@/server/http";

export const POST = route(async (req) => {
  await revokeStaffSession(readCookie(req, STAFF_COOKIE));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAFF_COOKIE, "", cookieOptions(0));
  return res;
});
