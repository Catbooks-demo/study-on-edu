import { NextResponse } from "next/server";
import { enforceLoginLimit } from "@/server/auth/ratelimit";
import { USER_COOKIE, USER_SESSION_DAYS, cookieOptions, issueUserSession } from "@/server/auth/session";
import { login, loginSchema, publicUser } from "@/server/auth/users";
import { clientIp, readJson, route } from "@/server/http";

export const POST = route(async (req) => {
  const { email, password } = await readJson(req, loginSchema);
  enforceLoginLimit("login", clientIp(req), email);
  const user = await login(email, password);
  const token = await issueUserSession(user.id);
  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(USER_COOKIE, token, cookieOptions(USER_SESSION_DAYS * 86_400));
  return res;
});
