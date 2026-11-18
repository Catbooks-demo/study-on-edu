import { NextResponse, type NextRequest } from "next/server";

/**
 * 직원·강사 화면: 쿠키가 없으면 각 로그인 화면으로 보낸다 (실제 확인은 각 화면·API에서 다시 한다).
 * 로그인 뒤 돌아갈 곳(next)은 로그인 화면이 같은 사이트 경로만 받는다(lib/nav.ts safeNext).
 */
const AREAS = [
  { prefix: "/admin", login: "/admin/login", cookie: "so_staff" },
  { prefix: "/instructor", login: "/instructor/login", cookie: "so_instructor" },
] as const;

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  for (const a of AREAS) {
    const inArea = pathname === a.prefix || pathname.startsWith(`${a.prefix}/`);
    if (!inArea || pathname === a.login) continue;
    if (!req.cookies.get(a.cookie)) {
      const url = req.nextUrl.clone();
      url.pathname = a.login;
      url.search = "";
      url.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin", "/admin/:path*", "/instructor", "/instructor/:path*"] };
