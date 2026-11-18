/** 로그인 뒤 이동할 곳: 우리 사이트 안의 경로만 (//, /\, 다른 주소 거부). */
export function safeNext(next: string | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  try {
    const u = new URL(next, "http://studyon.local");
    if (u.origin !== "http://studyon.local") return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
