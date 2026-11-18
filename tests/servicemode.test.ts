import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as staffLoginRoute } from "@/app/api/admin/auth/login/route";
import { POST as setModeRoute } from "@/app/api/admin/ops/mode/route";
import { POST as enter } from "@/app/api/live/[id]/enter/route";
import { POST as createOrderRoute } from "@/app/api/orders/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { STAFF_COOKIE, issueStaffSession } from "@/server/auth/session";
import { listCacheTtlSec } from "@/server/catalog";
import { db } from "@/server/db";
import { HttpError } from "@/server/http";
import { currentMode, guardMode, resetModeCache, setMode } from "@/server/servicemode";
import { resetDb } from "./helpers/db";
import { loginCookie, makeStaff, makeUser } from "./helpers/fixtures";
import { call } from "./helpers/http";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  resetModeCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function blocked(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof HttpError ? e : null;
  }
}

describe("서비스 모드", () => {
  it("기본은 normal", async () => {
    expect((await currentMode()).mode).toBe("normal");
    expect(listCacheTtlSec()).toBe(30);
    expect(listCacheTtlSec("degraded")).toBe(300);
  });

  it("read_only blocks order 503 but heartbeat ok", async () => {
    const admin = await makeStaff("admin");
    await setMode(`staff:${admin.id}`, "read_only", "결제사 점검");
    const user = await makeUser();
    const r = await call(createOrderRoute, { body: {}, cookies: await loginCookie(user.id) });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("SERVICE_MODE");
    expect(r.body.error.message).toBe("지금은 결제·가입·글쓰기를 잠시 막았어요. 수강은 그대로 할 수 있어요.");
    // 재생(play)은 열려 있다: 하트비트 경로(M4)도 같은 기능 분류를 쓴다
    await expect(guardMode("play")).resolves.toBeUndefined();
    const e = await call(enter, { body: {}, params: { id: "nope" }, cookies: await loginCookie(user.id) });
    expect(e.status).not.toBe(503);
  });

  it("degraded blocks review write", async () => {
    const admin = await makeStaff("admin");
    await setMode(`staff:${admin.id}`, "degraded", "접속 폭주");
    const e = await blocked(guardMode("heavy"));
    expect(e?.status).toBe(503);
    expect(e?.message).toBe("지금은 접속이 많아 이 기능을 잠시 쉬고 있어요.");
    await expect(guardMode("write")).resolves.toBeUndefined();
  });

  it("maintenance blocks login but staff passes", async () => {
    const admin = await makeStaff("admin");
    await setMode(`staff:${admin.id}`, "maintenance", "DB 업그레이드");
    const r = await call(login, { body: { email: "a@studyon.test", password: "whatever-pass" } });
    expect(r.status).toBe(503);
    expect(r.body.error.message).toBe("점검 중이에요. 잠시 후 다시 와 주세요.");
    // 직원 쿠키가 있으면 막지 않는다 (계정이 없으니 401)
    const staffCookie = { [STAFF_COOKIE]: await issueStaffSession(admin.id) };
    const r2 = await call(login, { body: { email: "a@studyon.test", password: "whatever-pass" }, cookies: staffCookie });
    expect(r2.status).toBe(401);
    // 직원 로그인은 늘 열려 있다
    const r3 = await call(staffLoginRoute, { body: { email: "nobody@studyon.test", password: "whatever-pass" } });
    expect(r3.status).toBe(401);
    await expect(guardMode("write", true)).resolves.toBeUndefined();
  });

  it("setMode needs reason", async () => {
    const admin = await makeStaff("admin");
    expect((await blocked(setMode(`staff:${admin.id}`, "degraded", "  ")))?.status).toBe(400);
    const cookies = { [STAFF_COOKIE]: await issueStaffSession(admin.id) };
    expect((await call(setModeRoute, { body: { mode: "degraded", reason: "" }, cookies })).status).toBe(400);
    expect((await call(setModeRoute, { body: { mode: "nope", reason: "x" }, cookies })).status).toBe(400);
    const cs = await makeStaff("cs");
    const csCookies = { [STAFF_COOKIE]: await issueStaffSession(cs.id) };
    expect((await call(setModeRoute, { body: { mode: "degraded", reason: "x" }, cookies: csCookies })).status).toBe(403);
    expect((await call(setModeRoute, { body: { mode: "degraded", reason: "접속 폭주" }, cookies })).status).toBe(200);
    resetModeCache();
    const m = await currentMode();
    expect(m.mode).toBe("degraded");
    expect(m.reason).toBe("접속 폭주");
    expect(m.changed_by).toBe(`staff:${admin.id}`);
  });

  it("audit row per change", async () => {
    const admin = await makeStaff("admin");
    await setMode(`staff:${admin.id}`, "degraded", "1");
    await setMode(`staff:${admin.id}`, "read_only", "2");
    await setMode(`staff:${admin.id}`, "normal", "3");
    expect(await db.serviceMode.count()).toBe(3);
    expect(await db.auditLog.count({ where: { action: "service_mode.set" } })).toBe(3);
    resetModeCache();
    expect((await currentMode()).mode).toBe("normal");
  });
});
