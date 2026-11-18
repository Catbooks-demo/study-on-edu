import { MODE_MESSAGE, type Feature, type Mode, allows, isMode } from "@/rules/servicemode";
import { audit } from "./audit";
import { db } from "./db";
import { onModeChanged } from "./hooks";
import { HttpError } from "./http";

export type ModeState = { mode: Mode; changed_by: string | null; reason: string | null; at: string | null };

const CACHE_MS = 5_000;
const g = globalThis as unknown as { __studyonMode?: { at: number; value: ModeState } };

const NORMAL: ModeState = { mode: "normal", changed_by: null, reason: null, at: null };

/** 지금 서비스 모드 (가장 최근 행, 메모리 5초 캐시). DB가 안 되면 마지막 값(없으면 normal). */
export async function currentMode(): Promise<ModeState> {
  const c = g.__studyonMode;
  if (c && Date.now() - c.at < CACHE_MS) return c.value;
  try {
    const row = await db.serviceMode.findFirst({ orderBy: [{ created_at: "desc" }, { id: "desc" }] });
    const value: ModeState = row && isMode(row.mode)
      ? { mode: row.mode, changed_by: row.changed_by, reason: row.reason, at: row.created_at.toISOString() }
      : NORMAL;
    g.__studyonMode = { at: Date.now(), value };
    return value;
  } catch {
    return c?.value ?? NORMAL;
  }
}

export function resetModeCache(): void {
  g.__studyonMode = undefined;
}

/**
 * 모드 바꾸기 (사유 필수). 행을 쌓고 감사 기록을 남기고 웹훅(service_mode.changed)을 같은 트랜잭션에 넣는다.
 * 사이트 배너는 모드에서 바로 나온다.
 */
export async function setMode(actor: string, mode: string, reason: string, now: Date = new Date()): Promise<ModeState> {
  if (!isMode(mode)) throw new HttpError(400, "BAD_INPUT", "모드는 normal, degraded, read_only, maintenance 중 하나예요.");
  const why = (reason ?? "").trim();
  if (!why) throw new HttpError(400, "REASON_REQUIRED", "바꾸는 사유를 적어 주세요.");
  if (why.length > 300) throw new HttpError(400, "BAD_INPUT", "사유는 300자까지 적어 주세요.");
  const prev = await currentMode();
  const row = await db.$transaction(async (tx) => {
    const r = await tx.serviceMode.create({ data: { mode, changed_by: actor, reason: why, created_at: now } });
    await audit(actor, "service_mode.set", `service_mode:${r.id}`, { from: prev.mode, to: mode, reason: why }, tx);
    await onModeChanged(tx, { from: prev.mode, to: mode, reason: why, at: now });
    return r;
  });
  const value: ModeState = { mode, changed_by: row.changed_by, reason: row.reason, at: row.created_at.toISOString() };
  g.__studyonMode = { at: Date.now(), value };
  return value;
}

export function modeError(mode: Exclude<Mode, "normal">): HttpError {
  return new HttpError(503, "SERVICE_MODE", MODE_MESSAGE[mode]);
}

/** 이 기능을 지금 쓸 수 있는지. 막히면 503 SERVICE_MODE. 직원은 건너뛴다. */
export async function guardMode(feature: Feature, isStaff = false): Promise<void> {
  if (isStaff) return;
  const { mode } = await currentMode();
  if (mode === "normal" || allows(mode, feature)) return;
  throw modeError(mode);
}

/** 막혀야 하는지만 (직원 확인 전에 먼저 본다). */
export async function blockedBy(feature: Feature): Promise<Exclude<Mode, "normal"> | null> {
  const { mode } = await currentMode();
  return mode === "normal" || allows(mode, feature) ? null : mode;
}
