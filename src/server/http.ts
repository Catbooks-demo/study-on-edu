import { NextResponse } from "next/server";
import type { z } from "zod";
import { log } from "./log";

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

export function errorResponse(e: unknown): NextResponse {
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
  log.error("처리 중 오류", { error: e instanceof Error ? e.stack ?? e.message : String(e) });
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "잠시 후 다시 시도해 주세요." } },
    { status: 500 },
  );
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** 오류를 JSON 응답으로 바꿔 주는 감싸기. */
export function route<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
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

/** 쿠키 하나 읽기 (Request 헤더에서). */
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
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
