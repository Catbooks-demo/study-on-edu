import { NextResponse } from "next/server";
import { dashboardCounts } from "@/server/admin";
import { requireStaff } from "@/server/auth/session";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

/** 직원 대시보드 숫자 (오늘 = 한국 날짜). */
export const GET = route(async (req) => {
  await requireStaff(req);
  return NextResponse.json({ counts: await dashboardCounts() });
});
