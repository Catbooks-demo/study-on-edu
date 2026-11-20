import type { InboxMessage } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./http";
import type { Tx } from "./tx";

/** 메시지함 글자 수 한도. */
export const INBOX_TITLE_MAX = 100;
export const INBOX_BODY_MAX = 2000;
/** 한 번에 보낼 수 있는 회원 수. */
export const INBOX_BATCH_MAX = 500;

export type InboxSource = "site" | "admin" | "api";

export type InboxInput = { kind: string; title: string; body: string; link?: string | null; coupon_id?: string | null };

/** 링크는 사이트 안 경로만 받는다(바깥 주소로 보내는 피싱 막기). */
export function cleanLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const l = link.trim();
  if (!l) return null;
  if (!l.startsWith("/") || l.startsWith("//") || l.includes("\\")) {
    throw new HttpError(400, "BAD_LINK", "링크는 /로 시작하는 사이트 안 경로만 쓸 수 있어요.");
  }
  return l;
}

/** 회원 여러 명의 메시지함에 같은 안내를 넣는다. 넣은 수를 돌려준다. */
export async function sendInbox(tx: Tx, userIds: string[], input: InboxInput, source: InboxSource): Promise<number> {
  if (userIds.length === 0) return 0;
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > INBOX_TITLE_MAX) throw new HttpError(400, "BAD_INPUT", "제목은 1~100자로 적어 주세요.");
  if (!body || body.length > INBOX_BODY_MAX) throw new HttpError(400, "BAD_INPUT", "내용은 1~2,000자로 적어 주세요.");
  const link = cleanLink(input.link);
  const r = await tx.inboxMessage.createMany({
    data: userIds.map((user_id) => ({ user_id, kind: input.kind, title, body, link, coupon_id: input.coupon_id ?? null, source })),
  });
  return r.count;
}

/** 있는 회원 id만 골라 낸다(순서 유지, 중복 제거). */
export async function splitMembers(tx: Tx, ids: string[]): Promise<{ found: string[]; missing: string[] }> {
  const uniq = [...new Set(ids)];
  const rows = await tx.user.findMany({ where: { id: { in: uniq } }, select: { id: true } });
  const have = new Set(rows.map((r) => r.id));
  return { found: uniq.filter((i) => have.has(i)), missing: uniq.filter((i) => !have.has(i)) };
}

/** 내 메시지함 (새것부터). */
export async function listInbox(userId: string, take = 100) {
  return db.inboxMessage.findMany({ where: { user_id: userId }, orderBy: [{ created_at: "desc" }, { id: "desc" }], take });
}

/** 안 읽은 메시지 수. */
export function unreadCount(userId: string): Promise<number> {
  return db.inboxMessage.count({ where: { user_id: userId, read_at: null } });
}

/** 읽음 표시. ids가 없으면 모두. 내 것만 바뀐다. 바뀐 수를 돌려준다. */
export async function markRead(userId: string, ids: string[] | null, now: Date = new Date()): Promise<number> {
  const r = await db.inboxMessage.updateMany({
    where: { user_id: userId, read_at: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { read_at: now },
  });
  return r.count;
}

export const inboxView = (m: InboxMessage) => ({
  id: m.id,
  kind: m.kind,
  title: m.title,
  body: m.body,
  link: m.link,
  coupon_id: m.coupon_id,
  read: m.read_at !== null,
  created_at: m.created_at.toISOString(),
});
