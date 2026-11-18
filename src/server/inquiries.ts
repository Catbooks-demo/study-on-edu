import type { Inquiry } from "@prisma/client";
import { LIMITS, enforceLimit } from "./auth/ratelimit";
import { audit } from "./audit";
import { db } from "./db";
import { HttpError } from "./http";
import { recordMessage } from "./messages";

export const INQUIRY_CATEGORIES = ["payment", "refund", "player", "subscription", "live", "etc"] as const;
export type InquiryCategory = (typeof INQUIRY_CATEGORIES)[number];

export const INQUIRY_CATEGORY_LABEL: Record<InquiryCategory, string> = {
  payment: "결제",
  refund: "환불",
  player: "재생·기기",
  subscription: "구독",
  live: "라이브",
  etc: "기타",
};

/** 1:1 문의. 쓰기 제한: 계정 10회/10분. */
export async function createInquiry(
  userId: string,
  input: { category: InquiryCategory; title: string; body: string },
  now: Date = new Date(),
): Promise<Inquiry> {
  enforceLimit(`inquiry:user:${userId}`, ...LIMITS.write, now.getTime());
  return db.inquiry.create({ data: { user_id: userId, category: input.category, title: input.title.trim(), body: input.body.trim(), created_at: now } });
}

export async function listMyInquiries(userId: string): Promise<Inquiry[]> {
  return db.inquiry.findMany({ where: { user_id: userId }, orderBy: { created_at: "desc" }, take: 100 });
}

/**
 * 문의 답변 (직원 화면·외부 API 공용). actor 형식: `staff:<id>`·`api:<키 이름>`.
 * 답변을 보낸 사실은 보낸 편지함에 이메일로 남긴다. 다시 답하면 답변을 바꾼다.
 */
export async function answerInquiry(actor: string, id: string, answer: string, now: Date = new Date()): Promise<Inquiry> {
  return db.$transaction(async (tx) => {
    const q = await tx.inquiry.findUnique({ where: { id }, include: { user: true } });
    if (!q) throw new HttpError(404, "NOT_FOUND", "문의를 찾지 못했어요.");
    const out = await tx.inquiry.update({ where: { id }, data: { answer: answer.trim(), answered_by: actor, answered_at: now, status: "answered" } });
    await recordMessage(tx, q.user, "inquiry_answered", `문의하신 "${q.title.slice(0, 30)}"에 답변드려요`, answer.trim());
    await audit(actor, "inquiry.answer", `inquiry:${id}`, undefined, tx);
    return out;
  });
}

export const inquiryView = (q: Inquiry) => ({
  id: q.id,
  category: q.category,
  title: q.title,
  body: q.body,
  status: q.status,
  answer: q.answer,
  answered_at: q.answered_at?.toISOString() ?? null,
  created_at: q.created_at.toISOString(),
});
