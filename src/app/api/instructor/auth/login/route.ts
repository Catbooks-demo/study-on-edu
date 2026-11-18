import { NextResponse } from "next/server";
import { enforceLoginLimit } from "@/server/auth/ratelimit";
import { INSTRUCTOR_COOKIE, INSTRUCTOR_SESSION_HOURS, cookieOptions, issueInstructorSession } from "@/server/auth/session";
import { instructorLogin, loginSchema, publicInstructor } from "@/server/auth/users";
import { clientIp, readJson, route } from "@/server/http";

export const POST = route(async (req) => {
  const { email, password } = await readJson(req, loginSchema);
  enforceLoginLimit("instructor-login", clientIp(req), email);
  const auth = await instructorLogin(email, password);
  const token = await issueInstructorSession(auth.user.id);
  const res = NextResponse.json(publicInstructor(auth));
  res.cookies.set(INSTRUCTOR_COOKIE, token, cookieOptions(INSTRUCTOR_SESSION_HOURS * 3600));
  return res;
});
