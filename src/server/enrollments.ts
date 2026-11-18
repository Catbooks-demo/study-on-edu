import type { Enrollment } from "@prisma/client";
import { db } from "./db";
import type { Tx } from "./tx";

const DAY_MS = 86_400_000;

/** 구독이 살아 있는 상태 (수강권을 구독으로 되돌릴 수 있는지). */
const SUB_ALIVE = ["active", "past_due", "paused"];
/** 구독 수강권으로 재생할 수 있는 상태 (일시정지는 안 된다). */
const SUB_PLAYABLE = ["active", "past_due"];

const expiryFrom = (start: Date, days: number | null) => (days ? new Date(start.getTime() + days * DAY_MS) : null);

/** 둘 중 늦은 만료 (null = 평생이 가장 늦다). */
const later = (a: Date | null, b: Date | null) => (a === null || b === null ? null : a > b ? a : b);

/** 구매로 얻은 수강권이 지금 살아 있는지 (구독 수강권의 null 만료는 평생이 아니다). */
function livePurchase(e: Enrollment | null, now: Date): e is Enrollment {
  return !!e && e.status === "active" && e.source !== "subscription" && (e.expires_at === null || e.expires_at > now);
}

async function grantOne(tx: Tx, userId: string, courseId: string, source: "order" | "bundle", itemId: string, expires: Date | null, now: Date) {
  const cur = await tx.enrollment.findUnique({ where: { user_id_course_id: { user_id: userId, course_id: courseId } } });
  if (!cur) {
    await tx.enrollment.create({
      data: { user_id: userId, course_id: courseId, source, order_item_id: itemId, starts_at: now, expires_at: expires },
    });
    return;
  }
  const keep = livePurchase(cur, now);
  await tx.enrollment.update({
    where: { id: cur.id },
    data: {
      source,
      order_item_id: itemId,
      subscription_id: null,
      status: "active",
      starts_at: keep ? cur.starts_at : now,
      expires_at: keep ? later(cur.expires_at, expires) : expires,
    },
  });
}

/**
 * 결제된 주문의 수강권을 만든다.
 * 단건은 강의 access_days, 패키지는 묶음 강의마다 source=bundle과 패키지 access_days.
 * 이미 수강권이 있으면 구매로 바꾸고 만료는 더 늦은 값을 쓴다.
 */
export async function grantForOrder(tx: Tx, orderId: string, now: Date): Promise<number> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { include: { course: true, bundle: { include: { courses: true } } } } },
  });
  let n = 0;
  for (const item of order.items) {
    if (item.status !== "active") continue;
    if (item.kind === "course" && item.course) {
      await grantOne(tx, order.user_id, item.course.id, "order", item.id, expiryFrom(now, item.course.access_days), now);
      n++;
    } else if (item.kind === "bundle" && item.bundle) {
      const expires = expiryFrom(now, item.bundle.access_days);
      for (const bc of item.bundle.courses) {
        await grantOne(tx, order.user_id, bc.course_id, "bundle", item.id, expires, now);
        n++;
      }
    }
  }
  return n;
}

/** 같은 강의를 다른 주문 항목(단건·패키지)으로도 샀고 그 항목이 아직 살아 있으면 그 항목과 만료. */
async function otherPurchase(tx: Tx, userId: string, courseId: string, exceptItemId: string, now: Date) {
  const items = await tx.orderItem.findMany({
    where: {
      id: { not: exceptItemId },
      status: "active",
      order: { user_id: userId, status: { in: ["paid", "partially_refunded"] }, paid_at: { not: null } },
      OR: [{ course_id: courseId }, { bundle: { courses: { some: { course_id: courseId } } } }],
    },
    include: { order: true, course: true, bundle: true },
  });
  let best: { itemId: string; source: "order" | "bundle"; expires: Date | null } | null = null;
  for (const it of items) {
    const days = it.kind === "course" ? (it.course?.access_days ?? null) : (it.bundle?.access_days ?? null);
    const expires = expiryFrom(it.order.paid_at!, days);
    if (expires !== null && expires <= now) continue;
    if (!best || later(best.expires, expires) !== best.expires) {
      best = { itemId: it.id, source: it.kind === "bundle" ? "bundle" : "order", expires };
    }
  }
  return best;
}

/**
 * 환불한 주문 항목의 수강권을 거둔다.
 * 같은 강의를 다른 항목으로도 샀으면 그쪽으로 옮기고, 구독이 살아 있고 구독 대상 강의면 구독 수강권으로 되돌린다.
 */
export async function refundEnrollments(tx: Tx, orderItemId: string, now: Date): Promise<number> {
  const es = await tx.enrollment.findMany({ where: { order_item_id: orderItemId, status: "active" }, include: { course: true } });
  for (const e of es) {
    const alt = await otherPurchase(tx, e.user_id, e.course_id, orderItemId, now);
    if (alt) {
      await tx.enrollment.update({ where: { id: e.id }, data: { order_item_id: alt.itemId, source: alt.source, expires_at: alt.expires } });
      continue;
    }
    const sub = e.course.in_subscription
      ? await tx.subscription.findFirst({ where: { user_id: e.user_id, status: { in: SUB_ALIVE } }, orderBy: { created_at: "desc" } })
      : null;
    if (sub) {
      await tx.enrollment.update({
        where: { id: e.id },
        data: { source: "subscription", subscription_id: sub.id, order_item_id: null, expires_at: null, status: "active" },
      });
    } else {
      await tx.enrollment.update({ where: { id: e.id }, data: { status: "refunded" } });
    }
  }
  return es.length;
}

/**
 * 지금 들을 수 있는 수강권. active이고 기한 전이어야 하고,
 * 구독 수강권이면 구독이 active·past_due여야 한다(일시정지 중에는 안 된다).
 */
export async function activeEnrollment(userId: string, courseId: string, now: Date = new Date()): Promise<Enrollment | null> {
  const e = await db.enrollment.findUnique({
    where: { user_id_course_id: { user_id: userId, course_id: courseId } },
    include: { subscription: true },
  });
  if (!e || e.status !== "active") return null;
  if (e.expires_at !== null && e.expires_at <= now) return null;
  if (e.source === "subscription" && !(e.subscription && SUB_PLAYABLE.includes(e.subscription.status))) return null;
  const { subscription: _s, ...enrollment } = e; // eslint-disable-line @typescript-eslint/no-unused-vars
  return enrollment;
}

/** 이미 산(구매 수강권이 살아 있는) 강의인지. 구독으로만 듣는 강의는 살 수 있다. */
export async function ownsCourse(tx: Tx, userId: string, courseId: string, now: Date): Promise<boolean> {
  const e = await tx.enrollment.findUnique({ where: { user_id_course_id: { user_id: userId, course_id: courseId } } });
  return livePurchase(e, now);
}
