import { db } from "./db";

/** FAQ 분류 이름. */
export const FAQ_CATEGORIES: Record<string, string> = {
  refund: "환불",
  subscription: "구독",
  device: "기기",
  certificate: "수료증",
  live: "라이브",
  etc: "기타",
};

/** 공개한 공지: 고정 공지 먼저, 그다음 최신순. */
export async function listNotices(take?: number) {
  return db.notice.findMany({
    where: { published: true },
    orderBy: [{ pinned: "desc" }, { created_at: "desc" }],
    take,
  });
}

/** 공개한 FAQ (분류를 주면 그 분류만), 정한 순서대로. */
export async function listFaqs(category?: string) {
  return db.faq.findMany({
    where: { published: true, ...(category ? { category } : {}) },
    orderBy: [{ sort: "asc" }, { created_at: "asc" }],
  });
}
