import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { requireStaff } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { computeMonth } from "@/server/settlements";

export const dynamic = "force-dynamic";

const body = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "정산 달을 YYYY-MM 형식으로 골라 주세요.") });

/** 그달 정산 다시 계산 (관리자만). draft만 바뀌고 확정한 정산은 그대로예요. */
export const POST = route(async (req) => {
  const staff = await requireStaff(req, "settlements");
  const { month } = await readJson(req, body);
  const count = await computeMonth(month);
  await audit(`staff:${staff.id}`, "settlement.compute", `month:${month}`, { count });
  return NextResponse.json({ month, count });
});
