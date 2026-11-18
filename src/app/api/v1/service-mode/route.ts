import { NextResponse } from "next/server";
import { z } from "zod";
import { MODES, SUGGEST, suggestMode } from "@/rules/servicemode";
import { apiActor, authApiKey } from "@/server/apikeys";
import { readJson, route } from "@/server/http";
import { recentWindow } from "@/server/metrics";
import { currentMode, setMode } from "@/server/servicemode";
import { componentStatus } from "@/server/status";

export const dynamic = "force-dynamic";

/**
 * 지금 서비스 모드, 이 앱의 최근 1분 지표(window), 그 지표로 낸 제안(suggestion), 제안 기준(thresholds),
 * 상태 페이지의 구성요소 상태 (read).
 */
export const GET = route(async (req) => {
  await authApiKey(req, "read");
  const now = new Date();
  const w = recentWindow(now);
  return NextResponse.json({
    ...(await currentMode()),
    modes: MODES,
    window: w,
    suggestion: suggestMode(w),
    thresholds: SUGGEST,
    components: await componentStatus(now),
  });
});

const body = z.object({ mode: z.string().max(20), reason: z.string().max(300) });

/** 모드 바꾸기 (write, 사유 필수). 감사 기록 actor는 `api:<키 이름>`, 웹훅 service_mode.changed가 나간다. */
export const POST = route(async (req) => {
  const key = await authApiKey(req, "write");
  const { mode, reason } = await readJson(req, body);
  return NextResponse.json(await setMode(apiActor(key), mode, reason));
});
