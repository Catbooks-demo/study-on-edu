/** 로그인 뒤 이동할 곳: 우리 사이트 안의 경로만 (//, /\, 다른 주소 거부). 없으면 마이페이지. */
export function safeNext(next: string | undefined, fallback = "/my"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  try {
    const u = new URL(next, "http://studyon.local");
    if (u.origin !== "http://studyon.local") return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

/** 주소 + 쿼리. 빈 값은 빼고, 순서를 지켜 같은 조건이면 같은 주소가 된다. */
export function withQuery(path: string, params: Params): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    p.set(k, v === true ? "1" : String(v));
  }
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}
