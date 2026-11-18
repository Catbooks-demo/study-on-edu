/** v1 목록 공통 (copy and adapt from nubi-tour/src/server/v1/paginate.ts). */
import { HttpError } from "../http";

export interface Page {
  since?: Date;
  after?: { at: Date; id: string };
  limit: number;
}

/** `?updated_since=ISO&cursor=…&limit=1..200` 읽기. 커서 = base64url("ISO|id"). */
export function readPage(req: Request): Page {
  const u = new URL(req.url);
  const limitRaw = u.searchParams.get("limit");
  const limit = limitRaw === null ? 50 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, "BAD_LIMIT", "limit은 1~200이에요.");
  const sinceRaw = u.searchParams.get("updated_since");
  let since: Date | undefined;
  if (sinceRaw) {
    since = new Date(sinceRaw);
    if (Number.isNaN(since.getTime())) throw new HttpError(400, "BAD_SINCE", "updated_since는 ISO 8601 시각이에요.");
  }
  const cursor = u.searchParams.get("cursor");
  let after: Page["after"];
  if (cursor) {
    const raw = Buffer.from(cursor, "base64url").toString();
    const i = raw.lastIndexOf("|");
    const at = new Date(i < 0 ? "" : raw.slice(0, i));
    if (i < 0 || Number.isNaN(at.getTime()) || !raw.slice(i + 1)) throw new HttpError(400, "BAD_CURSOR", "cursor가 올바르지 않아요.");
    after = { at, id: raw.slice(i + 1) };
  }
  return { since, after, limit };
}

/** Prisma where 조각: 바뀐 시각·id 오름차순으로 이어 읽기. */
export function pageWhere(p: Page) {
  const and: object[] = [];
  if (p.since) and.push({ updated_at: { gte: p.since } });
  if (p.after) and.push({ OR: [{ updated_at: { gt: p.after.at } }, { updated_at: p.after.at, id: { gt: p.after.id } }] });
  return and.length ? { AND: and } : {};
}

export const pageOrder = [{ updated_at: "asc" as const }, { id: "asc" as const }];

export function pageResult<T extends { updated_at: Date; id: string }, R>(rows: T[], p: Page, map: (r: T) => R) {
  const last = rows.at(-1);
  return {
    data: rows.map(map),
    next_cursor: rows.length === p.limit && last ? Buffer.from(`${last.updated_at.toISOString()}|${last.id}`).toString("base64url") : null,
  };
}
