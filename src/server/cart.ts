import { Prisma } from "@prisma/client";
import { type OrderPricing, type PriceLine, effectivePrice, priceOrder } from "@/rules/pricing";
import { db } from "./db";
import { ownsCourse } from "./enrollments";
import { HttpError } from "./http";
import type { Tx } from "./tx";

/** 장바구니·주문 한 줄 (가격 규칙 줄 + 화면에 쓸 정보). */
export type CartLine = PriceLine & {
  kind: "course" | "bundle";
  course_id: string | null;
  bundle_id: string | null;
  title: string;
  instructor_name: string | null;
  on_sale: boolean;
};

/** 패키지 줄의 분야 표시 (쿠폰 분야 대상에는 들지 않는다). */
export const BUNDLE_CATEGORY = "PKG";

export type CartTarget = { course_code?: string; bundle_code?: string };

const ALREADY = () => new HttpError(409, "ALREADY_ENROLLED", "이미 수강 중인 강의예요.");

/** 장바구니에 담기. 이미 산 강의는 409. 같은 것을 또 담으면 그대로 둔다. */
export async function addToCart(userId: string, t: CartTarget, now: Date = new Date()) {
  if (!!t.course_code === !!t.bundle_code) throw new HttpError(400, "BAD_INPUT", "강의나 패키지 하나를 골라 주세요.");
  if (t.course_code) {
    const c = await db.course.findUnique({ where: { code: t.course_code } });
    if (!c || c.status !== "published") throw new HttpError(404, "NOT_FOR_SALE", "판매 중인 강의가 아니에요.");
    if (await ownsCourse(db, userId, c.id, now)) throw ALREADY();
    return upsertItem({ user_id: userId, course_id: c.id });
  }
  const b = await db.bundle.findUnique({ where: { code: t.bundle_code! }, include: { courses: true } });
  if (!b || !b.active) throw new HttpError(404, "NOT_FOR_SALE", "판매 중인 패키지가 아니에요.");
  const owned = await Promise.all(b.courses.map((bc) => ownsCourse(db, userId, bc.course_id, now)));
  if (owned.length > 0 && owned.every(Boolean)) throw new HttpError(409, "ALREADY_ENROLLED", "패키지에 든 강의를 모두 수강 중이에요.");
  return upsertItem({ user_id: userId, bundle_id: b.id });
}

async function upsertItem(data: { user_id: string; course_id?: string; bundle_id?: string }) {
  try {
    return await db.cartItem.create({ data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return db.cartItem.findFirstOrThrow({ where: data });
    }
    throw e;
  }
}

/** 장바구니에서 빼기. */
export async function removeFromCart(userId: string, t: CartTarget): Promise<void> {
  if (t.course_code) await db.cartItem.deleteMany({ where: { user_id: userId, course: { code: t.course_code } } });
  if (t.bundle_code) await db.cartItem.deleteMany({ where: { user_id: userId, bundle: { code: t.bundle_code } } });
}

/** 장바구니 줄과 가격. at은 판매가를 정하는 시각(보통 지금). */
export async function cartLines(tx: Tx, userId: string, at: Date): Promise<CartLine[]> {
  const items = await tx.cartItem.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "asc" },
    include: {
      course: { include: { category: true, instructor: true } },
      bundle: { include: { courses: { include: { course: true } } } },
    },
  });
  const lines: CartLine[] = [];
  for (const it of items) {
    if (it.course) {
      const c = it.course;
      if (c.status !== "published") continue;
      const p = effectivePrice(c, at);
      lines.push({
        key: c.code,
        kind: "course",
        course_id: c.id,
        bundle_id: null,
        category: c.category.code,
        course_code: c.code,
        instructor_ids: [c.instructor_id],
        instructor_name: c.instructor.display_name,
        title: c.title,
        list: c.price,
        unit: p.unit,
        on_sale: p.onSale,
      });
    } else if (it.bundle) {
      const b = it.bundle;
      if (!b.active) continue;
      const list = b.courses.reduce((a, bc) => a + bc.course.price, 0);
      lines.push({
        key: b.code,
        kind: "bundle",
        course_id: null,
        bundle_id: b.id,
        category: BUNDLE_CATEGORY,
        course_code: null,
        instructor_ids: [...new Set(b.courses.map((bc) => bc.course.instructor_id))],
        instructor_name: null,
        title: b.title,
        list: Math.max(list, b.price),
        unit: b.price,
        on_sale: list > b.price,
      });
    }
  }
  return lines;
}

export async function getCart(userId: string, now: Date = new Date()): Promise<{ lines: CartLine[]; pricing: OrderPricing }> {
  const lines = await cartLines(db, userId, now);
  return { lines, pricing: priceOrder(lines, null) };
}
