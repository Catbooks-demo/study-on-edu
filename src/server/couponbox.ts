import type { Coupon } from "@prisma/client";
import { dateShort, won } from "@/lib/format";
import { kstDate } from "@/rules/time";
import { db } from "./db";
import { HttpError } from "./http";
import { INBOX_BATCH_MAX, type InboxSource, sendInbox, splitMembers } from "./inbox";
import { normalizeCode } from "./coupons";

/** 할인 표기: 정률 15% (최대 20,000원) · 정액 5,000원 */
export function discountLabel(c: Pick<Coupon, "kind" | "value" | "max_discount">): string {
  return c.kind === "percent" ? `${c.value}% 할인${c.max_discount ? ` (최대 ${won(c.max_discount)})` : ""}` : `${won(c.value)} 할인`;
}

/** 마지막으로 쓸 수 있는 날(한국 날짜). ends_at은 그 시각 전까지라서 1ms 앞을 본다. */
export const lastDay = (c: Pick<Coupon, "ends_at">) => kstDate(new Date(c.ends_at.getTime() - 1));

export type GrantResult = { coupon: Coupon; granted: string[]; already: string[]; not_found: string[] };

/**
 * 쿠폰함에 쿠폰 넣기 (멱등). 이미 받은 회원은 already, 없는 회원 id는 not_found.
 * 새로 받은 회원마다 메시지함에 안내가 하나 들어간다. 꺼졌거나 기간이 끝난 쿠폰·강사 추천 코드는 넣지 않는다.
 */
export async function grantCoupon(
  code: string,
  memberIds: string[],
  source: InboxSource,
  note: { title?: string; body?: string } = {},
  now: Date = new Date(),
): Promise<GrantResult> {
  if (memberIds.length === 0 || memberIds.length > INBOX_BATCH_MAX) {
    throw new HttpError(400, "BAD_INPUT", `회원은 한 번에 1~${INBOX_BATCH_MAX}명까지 보낼 수 있어요.`);
  }
  return db.$transaction(async (tx) => {
    const c = await tx.coupon.findUnique({ where: { code: normalizeCode(code) } });
    if (!c) throw new HttpError(404, "COUPON_NOT_FOUND", "쿠폰 번호를 다시 확인해 주세요.");
    if (c.referral) throw new HttpError(400, "REFERRAL_NOT_ALLOWED", "추천 코드(강사 쿠폰)는 쿠폰함에 넣을 수 없어요.");
    if (!c.active) throw new HttpError(409, "COUPON_INACTIVE", "꺼진 쿠폰은 보낼 수 없어요.");
    if (now >= c.ends_at) throw new HttpError(400, "COUPON_EXPIRED", "사용 기간이 끝난 쿠폰은 보낼 수 없어요.");
    const { found, missing } = await splitMembers(tx, memberIds);
    const had = await tx.userCoupon.findMany({ where: { coupon_id: c.id, user_id: { in: found } }, select: { user_id: true } });
    const hadSet = new Set(had.map((h) => h.user_id));
    const granted: string[] = [];
    const already = found.filter((id) => hadSet.has(id));
    for (const user_id of found.filter((id) => !hadSet.has(id))) {
      const r = await tx.userCoupon.createMany({ data: [{ user_id, coupon_id: c.id, source, issued_at: now }], skipDuplicates: true });
      (r.count ? granted : already).push(user_id);
    }
    await sendInbox(
      tx,
      granted,
      {
        kind: "coupon",
        title: note.title?.trim() || "쿠폰이 도착했어요",
        body:
          note.body?.trim() ||
          `${c.name || c.code} 쿠폰(${discountLabel(c)})을 받았어요. ${dateShort(lastDay(c))}까지 주문서의 '내 쿠폰'에서 고를 수 있어요.`,
        link: "/my/coupons",
        coupon_id: c.id,
      },
      source,
    );
    return { coupon: c, granted, already, not_found: missing };
  });
}

export type BoxState = "usable" | "used" | "expired" | "not_started" | "off";
export const BOX_STATE_KO: Record<BoxState, string> = {
  usable: "사용 가능",
  used: "사용함",
  expired: "기간 지남",
  not_started: "기간 전",
  off: "사용 중지",
};

/** 내 쿠폰함. 쓸 수 있는 것 먼저, 그다음 받은 순. */
export async function myCoupons(userId: string, now: Date = new Date()) {
  const rows = await db.userCoupon.findMany({ where: { user_id: userId }, include: { coupon: true }, orderBy: [{ issued_at: "desc" }, { id: "desc" }] });
  const used = new Set(
    (
      await db.couponRedemption.findMany({ where: { user_id: userId, coupon_id: { in: rows.map((r) => r.coupon_id) } }, select: { coupon_id: true } })
    ).map((r) => r.coupon_id),
  );
  const list = rows.map((r) => {
    const c = r.coupon;
    const state: BoxState = !c.active
      ? "off"
      : c.per_user_once && used.has(c.id)
        ? "used"
        : now >= c.ends_at
          ? "expired"
          : now < c.starts_at
            ? "not_started"
            : "usable";
    return {
      code: c.code,
      name: c.name || c.code,
      discount: discountLabel(c),
      min_amount: c.min_amount,
      target: c.target,
      target_ref: c.target_ref,
      last_day: lastDay(c),
      issued_at: r.issued_at.toISOString(),
      state,
    };
  });
  return [...list.filter((x) => x.state === "usable"), ...list.filter((x) => x.state !== "usable")];
}

export type BoxCoupon = Awaited<ReturnType<typeof myCoupons>>[number];

/** 받은 회원 전용 쿠폰은 1인 1회로 고정한다(쓴 여부를 사용 기록으로 알 수 있게). */
export const privateData = (isPrivate: boolean, perUserOnce: boolean) => ({ private: isPrivate, per_user_once: isPrivate || perUserOnce });
