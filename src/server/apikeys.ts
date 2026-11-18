import { randomBytes } from "node:crypto";
import type { ApiKey } from "@prisma/client";
import { enforceLimit } from "./auth/ratelimit";
import { sha256 } from "./auth/session";
import { db } from "./db";
import { HttpError } from "./http";

/** 외부 시스템 API 키 (`Authorization: Bearer sok_…`). DB에는 해시만 남긴다. */
export type Scope = "read" | "read_pii" | "write" | "metrics";
export const SCOPES: Scope[] = ["read", "read_pii", "write", "metrics"];
export const SCOPE_KO: Record<Scope, string> = {
  read: "읽기 (개인정보 가림)",
  read_pii: "읽기 (개인정보 원문)",
  write: "쓰기 (문의 답변·쿠폰·서비스 모드·장애 공지)",
  metrics: "지표 (/metrics)",
};
export const KEY_PREFIX = "sok_";
export type Need = "read" | "write" | "metrics";
/** 키당 분당 요청 한도. */
export const API_LIMIT_PER_MIN = 600;

/** 키 발급. 원문은 이때 한 번만 돌려준다. */
export async function issueApiKey(name: string, scopes: Scope[], createdBy?: string): Promise<{ key: string; prefix: string; id: string }> {
  const clean = [...new Set(scopes)].filter((s) => SCOPES.includes(s));
  if (!clean.length) throw new HttpError(400, "BAD_SCOPES", "범위를 하나 이상 골라 주세요.");
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = await db.apiKey.create({
    data: { name: name.trim().slice(0, 50) || "이름 없음", prefix: key.slice(0, 12), key_hash: sha256(key), scopes: clean, created_by: createdBy ?? null },
  });
  return { key, prefix: row.prefix, id: row.id };
}

/** 키 폐기. 이미 폐기한 키는 그대로 둔다. */
export async function revokeApiKey(id: string, now: Date = new Date()): Promise<ApiKey> {
  const k = await db.apiKey.findUnique({ where: { id } });
  if (!k) throw new HttpError(404, "NOT_FOUND", "API 키를 찾지 못했어요.");
  if (k.revoked_at) return k;
  return db.apiKey.update({ where: { id }, data: { revoked_at: now } });
}

/** 필요한 범위를 이 키가 갖고 있는지. read는 read·read_pii, metrics는 metrics만, write는 write만. */
export function hasScope(scopes: string[], need: Need): boolean {
  if (need === "read") return scopes.includes("read") || scopes.includes("read_pii");
  return scopes.includes(need);
}

const NEED_KO = { read: "읽기", write: "쓰기", metrics: "지표" } as const;

/**
 * `Authorization: Bearer <키>` 확인. 없거나 틀리거나 폐기됐으면 401, 범위가 모자라면 403, 분당 600회를 넘으면 429.
 */
export async function authApiKey(req: Request, need: Need): Promise<ApiKey> {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(\S{1,200})$/i);
  if (!m) throw new HttpError(401, "UNAUTHORIZED", "API 키가 필요해요 (Authorization: Bearer <키>).");
  const key = await db.apiKey.findUnique({ where: { key_hash: sha256(m[1]) } });
  if (!key || key.revoked_at) throw new HttpError(401, "UNAUTHORIZED", "API 키가 맞지 않거나 폐기됐어요.");
  if (!hasScope(key.scopes, need)) throw new HttpError(403, "FORBIDDEN", `이 키에는 ${NEED_KO[need]} 범위가 없어요.`);
  enforceLimit(`api:${key.id}`, API_LIMIT_PER_MIN, 60);
  if (!key.last_used_at || Date.now() - key.last_used_at.getTime() > 60_000) {
    await db.apiKey.update({ where: { id: key.id }, data: { last_used_at: new Date() } });
  }
  return key;
}

export const canSeePii = (k: ApiKey) => k.scopes.includes("read_pii");

/** 작업 기록·답변자에 남길 이름. */
export const apiActor = (k: ApiKey) => `api:${k.name}`;

/** 새로 만든 키 원문을 다음 화면에 한 번 넘기는 쿠키 이름 (1분, /admin/api-keys에서만). */
export const NEW_KEY_COOKIE = "so_newkey";
