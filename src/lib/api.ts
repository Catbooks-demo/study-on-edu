/** 브라우저에서 우리 API 부르기. 실패하면 서버가 준 문장을 그대로 던진다. */
export async function api<T = Record<string, unknown>>(url: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(url, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? "잠시 후 다시 시도해 주세요.");
  return data as T;
}
