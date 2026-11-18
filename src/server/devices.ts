import type { Device } from "@prisma/client";
import { audit } from "./audit";
import { db } from "./db";
import { HttpError } from "./http";
import type { Tx } from "./tx";

/** 계정당 등록 기기 수. */
export const DEVICE_LIMIT = 2;

/** so_device 쿠키 (브라우저가 만든 무작위 id, 1년). */
export const DEVICE_COOKIE = "so_device";
export const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** UA로 "Windows · Chrome" 같은 이름을 만든다. */
export function deviceName(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (!s.trim()) return "알 수 없는 기기";
  const os = /iPhone/.test(s)
    ? "iPhone"
    : /iPad/.test(s)
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /Windows/.test(s)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(s)
            ? "Mac"
            : /CrOS/.test(s)
              ? "ChromeOS"
              : /Linux/.test(s)
                ? "Linux"
                : "기타";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /SamsungBrowser/.test(s)
      ? "삼성 인터넷"
      : /Whale/.test(s)
        ? "Whale"
        : /Firefox|FxiOS/.test(s)
          ? "Firefox"
          : /Chrome|CriOS/.test(s)
            ? "Chrome"
            : /Safari/.test(s)
              ? "Safari"
              : "브라우저";
  return `${os} · ${browser}`;
}

/**
 * 기기 등록(이미 있으면 마지막 사용 시각만 갱신).
 * 회원 행을 잠가 같은 계정의 등록을 한 줄로 세운다: 동시에 새 기기 여러 대가 와도 2대를 넘지 않는다.
 */
export async function registerDevice(tx: Tx, userId: string, deviceKey: string, userAgent: string | null, now: Date): Promise<Device> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  const cur = await tx.device.findFirst({ where: { user_id: userId, device_key: deviceKey, revoked_at: null } });
  if (cur) return tx.device.update({ where: { id: cur.id }, data: { last_seen_at: now } });
  const active = await tx.device.count({ where: { user_id: userId, revoked_at: null } });
  if (active >= DEVICE_LIMIT) {
    throw new HttpError(409, "DEVICE_LIMIT", "등록 기기가 2대를 넘었어요. 마이페이지 › 기기 관리에서 쓰지 않는 기기를 해제해 주세요.");
  }
  return tx.device.create({
    data: { user_id: userId, device_key: deviceKey, name: deviceName(userAgent), first_seen_at: now, last_seen_at: now },
  });
}

/** 해제하지 않은 기기 (최근 사용 순). */
export async function listDevices(userId: string): Promise<Device[]> {
  return db.device.findMany({ where: { user_id: userId, revoked_at: null }, orderBy: { last_seen_at: "desc" } });
}

/** 화면·API에 내보내는 모양 (기기 키는 내보내지 않는다). */
export const deviceView = (d: Device, currentKey?: string) => ({
  id: d.id,
  name: d.name,
  first_seen_at: d.first_seen_at.toISOString(),
  last_seen_at: d.last_seen_at.toISOString(),
  current: currentKey !== undefined && d.device_key === currentKey,
});

export type DeviceActor = { kind: "user"; id: string } | { kind: "staff"; id: string };

/** 기기 해제 (본인 또는 직원). 그 기기의 재생 소유권도 지운다. 남의 기기면 404. */
export async function revokeDevice(actor: DeviceActor, deviceId: string, now: Date = new Date()): Promise<Device> {
  return db.$transaction(async (tx) => {
    const d = await tx.device.findUnique({ where: { id: deviceId } });
    if (!d || d.revoked_at || (actor.kind === "user" && d.user_id !== actor.id)) {
      throw new HttpError(404, "NOT_FOUND", "기기를 찾지 못했어요.");
    }
    const out = await tx.device.update({ where: { id: d.id }, data: { revoked_at: now } });
    await tx.playbackLease.deleteMany({ where: { user_id: d.user_id, device_id: d.id } });
    if (actor.kind === "staff") await audit(`staff:${actor.id}`, "device.revoke", `device:${d.id}`, { user_id: d.user_id }, tx);
    return out;
  });
}
