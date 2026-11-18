import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { hideReview } from "@/server/reviews";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ hidden: z.boolean() });

/** 후기 숨기기·보이기 (권한 support). 평점을 다시 계산한다. */
export const POST = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "support");
  const { id } = await params;
  const { hidden } = await readJson(req, body);
  const r = await hideReview(staff.id, id, hidden);
  return NextResponse.json({ review: { id: r.id, hidden: r.hidden } });
});
