/** 서버가 준 오류 (message는 화면에 그대로 보여 줄 문장). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | null,
    public detail: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** 브라우저에서 우리 API 부르기. 실패하면 서버가 준 문장을 그대로 던진다 (ApiError). */
export async function api<T = Record<string, unknown>>(url: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(url, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(err.message ?? "잠시 후 다시 시도해 주세요.", res.status, err.code ?? null, err);
  }
  return data as T;
}

/** 대기열 순번표를 받은 응답이면 대기 화면 주소, 아니면 null. */
export function waitingUrl(e: unknown, next: string): string | null {
  if (!(e instanceof ApiError) || e.code !== "QUEUE_WAIT" || typeof e.detail.ticket_id !== "string") return null;
  return `/waiting?ticket=${encodeURIComponent(e.detail.ticket_id)}&next=${encodeURIComponent(next)}`;
}
