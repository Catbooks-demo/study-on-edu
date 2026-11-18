import { NextResponse } from "next/server";
import { cookieOptions } from "./auth/session";
import type { CookieSpec } from "./queue";

/** 대기열 쿠키(HttpOnly)를 응답에 붙인다. */
export function withQueueCookies(res: NextResponse, cookies: CookieSpec[] | undefined): NextResponse {
  for (const c of cookies ?? []) res.cookies.set(c.name, c.value, cookieOptions(c.maxAge));
  return res;
}
