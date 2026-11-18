import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { addToCart, getCart, removeFromCart } from "@/server/cart";
import { readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

const target = z.object({
  course_code: z.string().min(1).max(40).optional(),
  bundle_code: z.string().min(1).max(40).optional(),
});

/** 내 장바구니 (줄과 가격). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json(await getCart(user.id));
});

/** 담기: {course_code} 또는 {bundle_code}. 이미 산 강의는 409. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const t = await readJson(req, target);
  const item = await addToCart(user.id, t);
  return NextResponse.json({ item: { id: item.id } }, { status: 201 });
});

/** 빼기. */
export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  const t = await readJson(req, target);
  await removeFromCart(user.id, t);
  return NextResponse.json({ ok: true });
});
