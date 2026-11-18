type AnyHandler = (req: Request, ctx: never) => Promise<Response> | Response;

export interface CallResult<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
  cookie: (name: string) => string | undefined;
}

/** 라우트 핸들러를 바로 부른다. */
export async function call<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  handler: AnyHandler,
  opts: {
    method?: string;
    body?: unknown;
    cookies?: Record<string, string | undefined>;
    headers?: Record<string, string>;
    params?: Record<string, string>;
    url?: string;
  } = {},
): Promise<CallResult<T>> {
  const headers = new Headers(opts.headers ?? {});
  const cookie = Object.entries(opts.cookies ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join("; ");
  if (cookie) headers.set("cookie", cookie);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  const req = new Request(opts.url ?? "http://localhost/test", {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const ctx = { params: Promise.resolve(opts.params ?? {}) } as never;
  const res = await handler(req, ctx);
  const text = await res.text();
  const setCookies = res.headers.getSetCookie();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : {}) as T,
    headers: res.headers,
    cookie: (name) => {
      const line = setCookies.find((c) => c.startsWith(`${name}=`));
      return line ? decodeURIComponent(line.slice(name.length + 1).split(";")[0]) : undefined;
    },
  };
}
