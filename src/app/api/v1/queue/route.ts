import { NextResponse } from "next/server";
import { z } from "zod";
import { apiActor, authApiKey } from "@/server/apikeys";
import { readJson, route } from "@/server/http";
import { listQueues, resetQueueCache, updateSetting } from "@/server/queue";

export const dynamic = "force-dynamic";

/** 대기열 설정과 통계 (read): 대상별 켜짐·초당 입장·대기 인원·평균 대기·최근 1분 입장. */
export const GET = route(async (req) => {
  await authApiKey(req, "read");
  return NextResponse.json({ data: await listQueues(new Date()) });
});

const body = z.object({
  target: z.string().max(60),
  enabled: z.boolean(),
  rate_per_sec: z.number(),
  course_codes: z.array(z.string().max(40)).max(200).optional(),
});

/** 대기열 켜기·끄기·한도 바꾸기 (write). 접속이 몰릴 때 site를 켠다. */
export const POST = route(async (req) => {
  const key = await authApiKey(req, "write");
  const b = await readJson(req, body);
  const s = await updateSetting(apiActor(key), b.target, b);
  resetQueueCache();
  return NextResponse.json({ data: { target: s.target, enabled: s.enabled, rate_per_sec: s.rate_per_sec, course_codes: s.course_codes } });
});
