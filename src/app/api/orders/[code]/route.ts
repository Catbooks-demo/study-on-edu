import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { getOrderForUser, orderView } from "@/server/orders";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

/** 내 주문 하나. 남의 주문이면 404. */
export const GET = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { code } = await params;
  return NextResponse.json({ order: orderView(await getOrderForUser(user.id, code)) });
}, { feature: "browse" });
