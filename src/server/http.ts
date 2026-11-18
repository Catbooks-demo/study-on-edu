import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { log } from "./log";
import { recordRequest, routeGroup } from "./metrics";

/** 수강생·강사·직원에게 보여 줄 수 있는 오류. 본문은 `{error:{code,message}}`. */
export class HttpError extends Error {
  /** 429일 때: 다시 시도할 수 있는 시각과 그때까지 남은 초. */
  retryAt?: Date;
  retryAfterSec?: number;

  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown, reqId?: string): NextResponse {
  if (e instanceof HttpError) {
    if (e.status === 429 && e.retryAt) {
      const after = e.retryAfterSec ?? Math.max(1, Math.ceil((e.retryAt.getTime() - Date.now()) / 1000));
      return NextResponse.json(
        { error: { code: e.code, message: e.message, retry_at: e.retryAt.toISOString() } },
        { status: 429, headers: { "Retry-After": String(after) } },
      );
    }
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  log.error("처리 중 오류", { req_id: reqId, error: e instanceof Error ? e.stack ?? e.message : String(e) });
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "잠시 후 다시 시도해 주세요." } },
    { status: 500 },
  );
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

export interface RouteOptions {
  /** 지표·로그의 경로 묶음. 없으면 요청 경로에서 routeGroup으로 만든다. */
  group?: string;
}

const REQ_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** 받은 x-request-id가 안전한 모양이면 그대로, 아니면 새로 만든다. */
export function requestId(req: Request): string {
  const got = req.headers.get("x-request-id");
  return got && REQ_ID_RE.test(got) ? got : randomUUID();
}

function withHeader(res: Response, name: string, value: string): Response {
  try {
    res.headers.set(name, value);
    return res;
  } catch {
    // Response.redirect 같은 응답은 헤더를 못 바꾸므로 새 응답으로 감싼다
    const copy = new Response(res.body, res);
    copy.headers.set(name, value);
    return copy;
  }
}

/**
 * 모든 API 감싸기: 오류를 JSON 응답으로 바꾸고, 요청 id(x-request-id)를 붙이고,
 * 지표(경로 묶음·상태·시간)를 기록하고, 요청마다 JSON 한 줄 로그를 남긴다.
 * 로그에는 쿠키·쿼리 문자열·본문을 넣지 않는다.
 */
export function route<C = unknown>(fn: Handler<C>, opts: RouteOptions = {}): Handler<C> {
  return async (req, ctx) => {
    const started = performance.now();
    const reqId = requestId(req);
    const group = opts.group ?? routeGroup(new URL(req.url).pathname);
    let res: Response;
    try {
      res = await fn(req, ctx);
    } catch (e) {
      res = errorResponse(e, reqId);
    }
    const ms = Math.round(performance.now() - started);
    recordRequest(group, req.method, res.status, ms);
    log.info("요청", { req_id: reqId, group, method: req.method, status: res.status, ms });
    return withHeader(res, "x-request-id", reqId);
  };
}

/** 요청 본문을 zod로 검사. 틀리면 400. */
export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "BAD_JSON", "요청 형식이 올바르지 않아요.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HttpError(400, "BAD_INPUT", first?.message ?? "입력값을 확인해 주세요.");
  }
  return parsed.data;
}

/** 쿠키 하나 읽기 (Request 헤더에서). 깨진 %-인코딩은 없는 쿠키로 본다(500이 나지 않게). */
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * 요청한 곳 IP. x-forwarded-for의 첫 값은 손님이 마음대로 넣을 수 있으므로,
 * 우리 nginx가 마지막에 붙인 값(바로 앞 접속 주소)을 쓴다.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.headers.get("x-real-ip") ?? "local";
}
