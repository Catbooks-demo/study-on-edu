import { z } from "zod";
import { DEVICE_KEY_RE } from "@/server/devices";

export const deviceKey = z.string().regex(DEVICE_KEY_RE, "기기 정보를 확인할 수 없어요. 새로고침해 주세요.");
const sec = z.number().finite().min(0).max(86_400);

export const startBody = z.object({ lecture_id: z.string().min(1).max(40), device_id: deviceKey });

export const heartbeatBody = z.object({
  lecture_id: z.string().min(1).max(40),
  from_sec: sec,
  to_sec: sec,
  position_sec: sec,
  rate: z.number().finite(),
  device_id: deviceKey,
});
