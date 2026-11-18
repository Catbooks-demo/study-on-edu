import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as listFaults, POST as setFaultRoute } from "@/app/api/admin/ops/faults/route";
import { GET as readyz } from "@/app/readyz/route";
import { addToCart } from "@/server/cart";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { STAFF_COOKIE, issueStaffSession } from "@/server/auth/session";
import { resetEnvCache } from "@/server/env";
import { faultsEnabled, getFaults, resetFaultCache, roll, setFault } from "@/server/faults";
import { HttpError } from "@/server/http";
import { renderMetrics, resetMetrics } from "@/server/metrics";
import { createOrder } from "@/server/orders";
import { mockPay } from "@/server/payments";
import { resetDb } from "./helpers/db";
import { makeCourse, makeStaff, makeUser } from "./helpers/fixtures";
import { call } from "./helpers/http";

function useFaults(on: boolean) {
  if (on) process.env.FAULTS_ENABLED = "true";
  else delete process.env.FAULTS_ENABLED;
  resetEnvCache();
  resetFaultCache();
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  resetMetrics();
  useFaults(false);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  useFaults(false);
});

async function adminCookie() {
  const admin = await makeStaff("admin");
  return { admin, cookies: { [STAFF_COOKIE]: await issueStaffSession(admin.id) } };
}

describe("장애 주입", () => {
  it("env false → faults inert and API 404", async () => {
    const { admin, cookies } = await adminCookie();
    expect(faultsEnabled()).toBe(false);
    expect((await call(listFaults, { cookies })).status).toBe(404);
    expect((await call(setFaultRoute, { body: { key: "login_5xx_rate", enabled: true, value: 1 }, cookies })).status).toBe(404);
    await expect(setFault(admin.id, "login_5xx_rate", { enabled: true, value: 1 })).rejects.toBeInstanceOf(HttpError);
    expect(await getFaults()).toEqual({});
  });

  it("login_5xx_rate 1 → 503", async () => {
    useFaults(true);
    const { cookies } = await adminCookie();
    const r = await call(setFaultRoute, { body: { key: "login_5xx_rate", enabled: true, value: 1 }, cookies });
    expect(r.status).toBe(200);
    resetFaultCache();
    const res = await call(login, { body: { email: "a@studyon.test", password: "whatever-pass" }, url: "http://localhost/api/auth/login" });
    expect(res.status).toBe(503);
  });

  it("roll(0.3, ()=>0.29) true / ()=>0.3 false", () => {
    expect(roll(0.3, () => 0.29)).toBe(true);
    expect(roll(0.3, () => 0.3)).toBe(false);
    expect(roll(0, () => 0)).toBe(false);
    expect(roll(1, () => 0.999)).toBe(true);
  });

  it("payment_fail_rate 1 → mockPay fails, payment_failures_total +1", async () => {
    useFaults(true);
    const { admin } = await adminCookie();
    await setFault(admin.id, "payment_fail_rate", { enabled: true, value: 1 });
    resetFaultCache();
    const user = await makeUser();
    const { course } = await makeCourse({ price: 50_000 });
    await addToCart(user.id, { course_code: course.code });
    const order = await createOrder(user.id, {});
    const err = await mockPay(order.code).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(402);
    const text = await renderMetrics(new Date());
    expect(text).toContain('studyon_payment_failures_total{method="mock"} 1');
  });

  it("db_delay_ms 600 → readyz ≥ 600ms and slow query counted", async () => {
    useFaults(true);
    const { admin } = await adminCookie();
    await setFault(admin.id, "db_delay_ms", { enabled: true, value: 600 });
    resetFaultCache();
    const t = performance.now();
    const res = await readyz();
    expect(res.status).toBe(200);
    expect(performance.now() - t).toBeGreaterThanOrEqual(590);
    expect(await renderMetrics(new Date())).toMatch(/studyon_db_slow_queries_total [1-9]/);
  });

  it("non-admin 403", async () => {
    useFaults(true);
    const cs = await makeStaff("cs");
    const cookies = { [STAFF_COOKIE]: await issueStaffSession(cs.id) };
    expect((await call(setFaultRoute, { body: { key: "login_5xx_rate", enabled: true, value: 1 }, cookies })).status).toBe(403);
    expect((await call(listFaults, { cookies })).status).toBe(403);
  });

  it("audit row per change, disabled fault is inert", async () => {
    useFaults(true);
    const { admin } = await adminCookie();
    await setFault(admin.id, "login_5xx_rate", { enabled: true, value: 1 });
    await setFault(admin.id, "login_5xx_rate", { enabled: false, value: 1 });
    resetFaultCache();
    expect(await getFaults()).toEqual({});
    const { db } = await import("@/server/db");
    expect(await db.auditLog.count({ where: { action: "fault.set" } })).toBe(2);
  });
});
