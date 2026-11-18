import { NextResponse } from "next/server";
import { INSTRUCTOR_COOKIE, cookieOptions, revokeInstructorSession } from "@/server/auth/session";
import { readCookie, route } from "@/server/http";

export const POST = route(async (req) => {
  await revokeInstructorSession(readCookie(req, INSTRUCTOR_COOKIE));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(INSTRUCTOR_COOKIE, "", cookieOptions(0, req));
  return res;
});
