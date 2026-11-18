import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { LIMITS, enforceLimit, rateLimit, resetRateLimits } from "@/server/auth/ratelimit";
import { errorResponse } from "@/server/http";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

const form = {
  email: "limit@example.com",
  password: "study-2026",
  name: "이제한",
  phone: "010-2222-3333",
  agree_terms: true,
  agree_privacy: true,
};

describe("요청 제한", () => {
  it("11th wrong login → 429 with Retry-After", async () => {
    await call(signup, { body: form });
    for (let i = 0; i < 10; i++) {
      expect((await call(login, { body: { email: form.email, password: "wrong-pass" } })).status).toBe(401);
    }
    const r = await call(login, { body: { email: form.email, password: form.password } });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("RATE_LIMITED");
    expect(r.body.error.message).toBe("요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
    const after = Number(r.headers.get("Retry-After"));
    expect(Number.isInteger(after)).toBe(true);
    expect(after).toBeGreaterThanOrEqual(1);
    expect(after).toBeLessThanOrEqual(600);
    expect(r.body.error.retry_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    expect(new Date(r.body.error.retry_at).toISOString()).toBe(r.body.error.retry_at);
  });

  it("rateLimit window", () => {
    expect(rateLimit("k", 2, 60, 0).ok).toBe(true);
    expect(rateLimit("k", 2, 60, 0).ok).toBe(true);
    const third = rateLimit("k", 2, 60, 0);
    expect(third.ok).toBe(false);
    expect(third.retryAt.getTime()).toBe(60_000);
    expect(rateLimit("k", 2, 60, 60_001).ok).toBe(true);
  });

  it("enforceLimit throws 429 with retry time", async () => {
    enforceLimit("e", 1, 60, 1_000);
    let err: unknown;
    try {
      enforceLimit("e", 1, 60, 2_000);
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    const res = errorResponse(err);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("59");
    const body = await res.json();
    expect(body.error.retry_at).toBe(new Date(61_000).toISOString());
  });

  it("LIMITS values", () => {
    expect(LIMITS).toEqual({
      login: { ipEmail: [10, 600], ip: [30, 600] },
      signup: [5, 600],
      checkout: { user: [20, 60], ip: [60, 60] },
      write: [10, 600],
      chat: [30, 60],
      api: [600, 60],
    });
  });

  it("signup limited to 5 per IP in 10 minutes", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await call(signup, { body: { ...form, email: `s${i}@example.com` }, headers: { "x-real-ip": "10.0.0.9" } });
      expect(r.status).toBe(201);
    }
    const r = await call(signup, { body: { ...form, email: "s9@example.com" }, headers: { "x-real-ip": "10.0.0.9" } });
    expect(r.status).toBe(429);
  });
});
