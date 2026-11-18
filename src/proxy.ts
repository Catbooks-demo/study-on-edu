import { NextResponse, type NextRequest } from "next/server";

/**
 * 1) 직원·강사 화면: 쿠키가 없으면 각 로그인 화면으로 보낸다 (실제 확인은 각 화면·API에서 다시 한다).
 *    로그인 뒤 돌아갈 곳(next)은 로그인 화면이 같은 사이트 경로만 받는다(lib/nav.ts safeNext).
 * 2) 수강생 화면: 지금 경로를 `x-so-path` 요청 헤더로 넘긴다. 사이트 레이아웃이 점검 화면·대기열 문에서
 *    예외 경로(/status, /waiting 등)를 가리고 돌아올 곳(next)을 정하는 데 쓴다. 손님이 보낸 같은 헤더는 덮어쓴다.
 */
const AREAS = [
  { prefix: "/admin", login: "/admin/login", cookie: "so_staff" },
  { prefix: "/instructor", login: "/instructor/login", cookie: "so_instructor" },
] as const;

const PATH_HEADER = "x-so-path";

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
  const headers = new Headers(req.headers);
  headers.set(PATH_HEADER, `${pathname}${search}`.slice(0, 500));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // 정적 파일·API·지표·상태 확인은 거치지 않는다
  matcher: ["/((?!_next/|api/|metrics|healthz|readyz|favicon\.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|woff2?)$).*)"],
};
