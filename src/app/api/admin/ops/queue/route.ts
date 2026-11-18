import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { listQueues, resetQueueCache, updateSetting } from "@/server/queue";

export const dynamic = "force-dynamic";

/** 대기열 설정·통계. admin만. */
export const GET = route(async (req) => {
  await requireStaff(req, "ops");
  return NextResponse.json({ queues: await listQueues(new Date()) });
});

const body = z.object({
  target: z.string().max(60),
  enabled: z.boolean(),
  rate_per_sec: z.number(),
  course_codes: z.array(z.string().max(40)).max(200).optional(),
});

/** 대기열 켜기·끄기·한도 바꾸기. admin만. */
export const POST = route(async (req) => {
  const staff = await requireStaff(req, "ops");
  const b = await readJson(req, body);
  const s = await updateSetting(`staff:${staff.id}`, b.target, b);
  resetQueueCache();
  return NextResponse.json({ queue: { target: s.target, enabled: s.enabled, rate_per_sec: s.rate_per_sec, course_codes: s.course_codes } });
});
