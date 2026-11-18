import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as adminLogin } from "@/app/api/admin/auth/login/route";
import { hashPassword } from "@/server/auth/password";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { cookieOptions, sha256 } from "@/server/auth/session";
import { db } from "@/server/db";
import { resetEnvCache } from "@/server/env";
import { JOBS, purgeExpiredSessions } from "@/server/jobs";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { makeInstructor, makeStaff, makeUser } from "./helpers/fixtures";

const saved = { ...process.env };

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("만료 세션 지우기", () => {
  it("purges expired sessions of all three kinds", async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    const future = new Date(now.getTime() + 3_600_000);
    const user = await makeUser();
    const staff = await makeStaff("cs");
    const instructor = await makeInstructor();
    const iu = await db.instructorUser.create({ data: { email: "purge@studyon.test", password_hash: "scrypt$test", instructor_id: instructor.id } });
    await db.session.createMany({ data: [{ token_hash: sha256("u-old"), user_id: user.id, expires_at: past }, { token_hash: sha256("u-new"), user_id: user.id, expires_at: future }] });
    await db.staffSession.createMany({ data: [{ token_hash: sha256("s-old"), staff_id: staff.id, expires_at: past }, { token_hash: sha256("s-new"), staff_id: staff.id, expires_at: future }] });
    await db.instructorSession.createMany({
      data: [{ token_hash: sha256("i-old"), instructor_user_id: iu.id, expires_at: past }, { token_hash: sha256("i-new"), instructor_user_id: iu.id, expires_at: future }],
    });

    expect(await purgeExpiredSessions(now)).toBe(3);
    expect(await db.session.count()).toBe(1);
    expect(await db.staffSession.count()).toBe(1);
    expect(await db.instructorSession.count()).toBe(1);
    expect(await purgeExpiredSessions(now)).toBe(0);
    expect(Object.keys(JOBS)).toContain("purgeExpiredSessions");
  });
});

describe("Secure 쿠키", () => {
  const loginOnce = async (headers: Record<string, string> = {}) => {
    await db.staff.deleteMany();
    await db.staff.create({ data: { email: "secure@studyon.test", name: "보안", role: "admin", password_hash: await hashPassword("secure-pass-2026") } });
    resetRateLimits();
    const res = await call(adminLogin, { body: { email: "secure@studyon.test", password: "secure-pass-2026" }, headers });
    expect(res.status).toBe(200);
    return res.headers.getSetCookie().find((c) => c.startsWith("so_staff=")) ?? "";
  };

  it("https base url sets Secure", async () => {
    process.env.APP_BASE_URL = "https://studyon.example";
    resetEnvCache();
    expect(cookieOptions(60).secure).toBe(true);
    expect(await loginOnce()).toMatch(/;\s*Secure/i);
  });

  it("production behind https proxy sets Secure", async () => {
    process.env.APP_BASE_URL = "http://10.0.0.5:3000";
    resetEnvCache();
    expect(await loginOnce({ "x-forwarded-proto": "https" })).toMatch(/;\s*Secure/i);
  });

  it("plain http local stays non-Secure", async () => {
    process.env.APP_BASE_URL = "http://localhost:3000";
    resetEnvCache();
    expect(cookieOptions(60).secure).toBe(false);
    expect(await loginOnce()).not.toMatch(/;\s*Secure/i);
  });
});
