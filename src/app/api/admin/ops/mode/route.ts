import { NextResponse } from "next/server";
import { z } from "zod";
import { SUGGEST, suggestMode } from "@/rules/servicemode";
import { requireStaff } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { recentWindow } from "@/server/metrics";
import { currentMode, setMode } from "@/server/servicemode";

export const dynamic = "force-dynamic";

/** 지금 모드·최근 1분 지표·자동 제안. admin만. */
export const GET = route(async (req) => {
  await requireStaff(req, "ops");
  const w = recentWindow(new Date());
  return NextResponse.json({ ...(await currentMode()), window: w, suggestion: suggestMode(w), thresholds: SUGGEST });
});

const body = z.object({ mode: z.string(), reason: z.string().max(300) });

/** 모드 바꾸기 (사유 필수). admin만. */
export const POST = route(async (req) => {
  const staff = await requireStaff(req, "ops");
  const { mode, reason } = await readJson(req, body);
  return NextResponse.json(await setMode(`staff:${staff.id}`, mode, reason));
});
