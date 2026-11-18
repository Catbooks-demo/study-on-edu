import { kstDate } from "@/rules/time";
import type { Tx } from "./tx";

/** 일련번호 하나 늘리기. 표 counters(key, last)에서 원자적으로 늘리므로 동시에 불러도 겹치지 않는다. */
export async function nextCode(tx: Tx, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO counters (key, last) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET last = counters.last + 1
    RETURNING last`;
  return Number(rows[0].last);
}

/** 주문번호: SO + 한국 날짜 yyMMdd + 그날 일련 4자리 (SO2611180001). */
export async function nextOrderCode(tx: Tx, now: Date): Promise<string> {
  const day = kstDate(now).replace(/-/g, "").slice(2);
  const n = await nextCode(tx, `order:${day}`);
  return `SO${day}${String(n).padStart(4, "0")}`;
}

/** 강의 코드: SO-<분야>-<4자리> (SO-DEV-0001). */
export async function nextCourseCode(tx: Tx, categoryCode: string): Promise<string> {
  const n = await nextCode(tx, `course:${categoryCode}`);
  return `SO-${categoryCode}-${String(n).padStart(4, "0")}`;
}

/** 수료증 번호: SOC-<한국 연도>-<6자리> (SOC-2026-000001). */
export async function nextCertificateNo(tx: Tx, now: Date): Promise<string> {
  const year = kstDate(now).slice(0, 4);
  const n = await nextCode(tx, `certificate:${year}`);
  return `SOC-${year}-${String(n).padStart(6, "0")}`;
}
