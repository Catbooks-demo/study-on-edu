import { NextResponse } from "next/server";
import { LIMITS, enforceLimit } from "@/server/auth/ratelimit";
import { USER_COOKIE, USER_SESSION_DAYS, cookieOptions, issueUserSession } from "@/server/auth/session";
import { publicUser, signup, signupSchema } from "@/server/auth/users";
import { clientIp, readJson, route } from "@/server/http";

export const POST = route(async (req) => {
  enforceLimit(`signup:ip:${clientIp(req)}`, ...LIMITS.signup);
  const input = await readJson(req, signupSchema);
  const user = await signup(input);
  const token = await issueUserSession(user.id);
  const res = NextResponse.json({ user: publicUser(user) }, { status: 201 });
  res.cookies.set(USER_COOKIE, token, cookieOptions(USER_SESSION_DAYS * 86_400));
  return res;
});
