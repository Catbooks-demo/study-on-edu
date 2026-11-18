import { beforeEach, describe, expect, it } from "vitest";
import { GET as devicesGet } from "@/app/api/devices/route";
import { DELETE as deviceDelete } from "@/app/api/devices/[id]/route";
import { POST as heartbeatRoute } from "@/app/api/player/heartbeat/route";
import { POST as startRoute } from "@/app/api/player/start/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { db } from "@/server/db";
import { deviceName, listDevices, registerDevice, revokeDevice } from "@/server/devices";
import { heartbeat, startPlayback } from "@/server/player";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { loginCookie, makeCourse, makeStaff, makeUser } from "./helpers/fixtures";

const A = "device-aaaaaaaa";
const B = "device-bbbbbbbb";
const C = "device-cccccccc";
const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

async function enrolled() {
  const now = new Date();
  const user = await makeUser();
  const { course, lectures } = await makeCourse({ lectures: [600, 600] });
  await db.enrollment.create({ data: { user_id: user.id, course_id: course.id, source: "free", starts_at: now, expires_at: null } });
  return { now, user, course, lectures };
}

const beat = (lecture_id: string, device_id: string, from = 0, to = 20) => ({ lecture_id, from_sec: from, to_sec: to, position_sec: to, rate: 1, device_id });
const at = (base: Date, sec: number) => new Date(base.getTime() + sec * 1000);

describe("기기", () => {
  it("names from user agent", () => {
    expect(deviceName(WIN_CHROME)).toBe("Windows · Chrome");
    expect(deviceName(IPHONE_SAFARI)).toBe("iPhone · Safari");
    expect(deviceName("")).toBe("알 수 없는 기기");
  });

  it("third device 409 DEVICE_LIMIT", async () => {
    const { now, user, lectures } = await enrolled();
    await startPlayback(user.id, { lecture_id: lectures[0].id, device_id: A }, now);
    await startPlayback(user.id, { lecture_id: lectures[0].id, device_id: B }, now);
    await expect(startPlayback(user.id, { lecture_id: lectures[0].id, device_id: C }, now)).rejects.toMatchObject({
      status: 409,
      code: "DEVICE_LIMIT",
      message: "등록 기기가 2대를 넘었어요. 마이페이지 › 기기 관리에서 쓰지 않는 기기를 해제해 주세요.",
    });
    expect(await db.device.count({ where: { user_id: user.id, revoked_at: null } })).toBe(2);
  });

  it("concurrent new devices never exceed 2", async () => {
    const user = await makeUser();
    const now = new Date();
    const keys = ["device-11111111", "device-22222222", "device-33333333", "device-44444444"];
    const results = await Promise.allSettled(keys.map((k) => db.$transaction((tx) => registerDevice(tx, user.id, k, WIN_CHROME, now))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await db.device.count({ where: { user_id: user.id, revoked_at: null } })).toBe(2);
  });

  it("revoke frees slot", async () => {
    const { now, user, lectures } = await enrolled();
    await startPlayback(user.id, { lecture_id: lectures[0].id, device_id: A }, now);
    await startPlayback(user.id, { lecture_id: lectures[0].id, device_id: B }, now);
    const devices = await listDevices(user.id);
    expect(devices).toHaveLength(2);
    const b = devices.find((d) => d.device_key === B)!;
    await revokeDevice({ kind: "user", id: user.id }, b.id);
    // 해제한 기기의 재생 소유권도 지운다 (B가 마지막으로 시작했다)
    expect(await db.playbackLease.count({ where: { user_id: user.id } })).toBe(0);
    await startPlayback(user.id, { lecture_id: lectures[0].id, device_id: C }, now);
    expect((await listDevices(user.id)).map((d) => d.device_key).sort()).toEqual([A, C]);
  });

  it("cannot revoke someone else's device; staff can", async () => {
    const { now, user, lectures } = await enrolled();
    const other = await makeUser();
    await startPlayback(user.id, { lecture_id: lectures[0].id, device_id: A }, now);
    const [d] = await listDevices(user.id);
    await expect(revokeDevice({ kind: "user", id: other.id }, d.id)).rejects.toMatchObject({ status: 404 });
    const res = await call(deviceDelete, { method: "DELETE", cookies: await loginCookie(other.id), params: { id: d.id } });
    expect(res.status).toBe(404);
    const staff = await makeStaff("cs");
    await revokeDevice({ kind: "staff", id: staff.id }, d.id);
    expect(await listDevices(user.id)).toHaveLength(0);
    expect(await db.auditLog.count({ where: { target: `device:${d.id}` } })).toBe(1);
  });

  it("device list and delete routes", async () => {
    const { user, lectures } = await enrolled();
    const cookies = await loginCookie(user.id);
    const s = await call(startRoute, { cookies, headers: { "user-agent": WIN_CHROME }, body: { lecture_id: lectures[0].id, device_id: A } });
    expect(s.status).toBe(200);
    const list = await call(devicesGet, { cookies });
    expect(list.status).toBe(200);
    expect(list.body.devices).toHaveLength(1);
    expect(list.body.devices[0].name).toBe("Windows · Chrome");
    expect(list.body.devices[0].device_key).toBeUndefined();
    const del = await call(deviceDelete, { method: "DELETE", cookies, params: { id: list.body.devices[0].id } });
    expect(del.status).toBe(200);
    expect((await call(devicesGet, { cookies })).body.devices).toHaveLength(0);
  });

  it("second device takes over", async () => {
    const { now, user, lectures } = await enrolled();
    const l = lectures[0];
    await startPlayback(user.id, { lecture_id: l.id, device_id: A }, now);
    await startPlayback(user.id, { lecture_id: l.id, device_id: B }, at(now, 5));
    await expect(heartbeat(user.id, beat(l.id, A), at(now, 20))).rejects.toMatchObject({
      status: 409,
      code: "PLAYING_ELSEWHERE",
      message: "다른 기기에서 재생을 시작해서 여기서는 멈췄어요.",
    });
    const ok = await heartbeat(user.id, beat(l.id, B), at(now, 25));
    expect(ok.watched_sec).toBe(20);

    const cookies = await loginCookie(user.id);
    const res = await call(heartbeatRoute, { cookies, body: beat(l.id, A, 20, 40) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PLAYING_ELSEWHERE");
  });

  it("same device restart keeps lease", async () => {
    const { now, user, lectures } = await enrolled();
    await startPlayback(user.id, { lecture_id: lectures[0].id, device_id: A }, now);
    const again = await startPlayback(user.id, { lecture_id: lectures[1].id, device_id: A }, at(now, 10));
    expect(again.lease).toBe(true);
    const r = await heartbeat(user.id, beat(lectures[1].id, A), at(now, 30));
    expect(r.watched_sec).toBe(20);
    expect(await db.device.count({ where: { user_id: user.id } })).toBe(1);
    const lease = await db.playbackLease.findUniqueOrThrow({ where: { user_id: user.id } });
    expect(lease.lecture_id).toBe(lectures[1].id);
  });
});
