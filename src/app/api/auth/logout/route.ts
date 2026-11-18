import { NextResponse } from "next/server";
import { USER_COOKIE, cookieOptions, revokeUserSession } from "@/server/auth/session";
import { readCookie, route } from "@/server/http";

export const POST = route(async (req) => {
  await revokeUserSession(readCookie(req, USER_COOKIE));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE, "", cookieOptions(0, req));
  return res;
}, { feature: "auth" });
