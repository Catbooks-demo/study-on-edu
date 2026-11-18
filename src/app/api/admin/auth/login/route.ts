import { NextResponse } from "next/server";
import { enforceLoginLimit } from "@/server/auth/ratelimit";
import { STAFF_COOKIE, STAFF_SESSION_HOURS, cookieOptions, issueStaffSession } from "@/server/auth/session";
import { loginSchema, publicStaff, staffLogin } from "@/server/auth/users";
import { clientIp, readJson, route } from "@/server/http";

export const POST = route(async (req) => {
  const { email, password } = await readJson(req, loginSchema);
  enforceLoginLimit("staff-login", clientIp(req), email);
  const staff = await staffLogin(email, password);
  const token = await issueStaffSession(staff.id);
  const res = NextResponse.json({ staff: publicStaff(staff) });
  res.cookies.set(STAFF_COOKIE, token, cookieOptions(STAFF_SESSION_HOURS * 3600));
  return res;
});
