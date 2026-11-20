import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { myCoupons } from "@/server/couponbox";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

/** 내 쿠폰함 (state: usable, used, expired, not_started, off). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json({ coupons: await myCoupons(user.id) });
}, { feature: "browse" });
