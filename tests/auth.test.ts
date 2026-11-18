import { beforeEach, describe, expect, it } from "vitest";
import { POST as adminLogin } from "@/app/api/admin/auth/login/route";
import { POST as adminLogout } from "@/app/api/admin/auth/logout/route";
import { GET as adminMe } from "@/app/api/admin/auth/me/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as instructorLogin } from "@/app/api/instructor/auth/login/route";
import { POST as instructorLogout } from "@/app/api/instructor/auth/logout/route";
import { GET as instructorMe } from "@/app/api/instructor/auth/me/route";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { resetRateLimits } from "@/server/auth/ratelimit";
import {
  INSTRUCTOR_COOKIE,
  STAFF_COOKIE,
  USER_COOKIE,
  issueInstructorSession,
  issueStaffSession,
  requireInstructor,
  requireStaff,
} from "@/server/auth/session";
import { db } from "@/server/db";
import { HttpError } from "@/server/http";
import { can } from "@/server/roles";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { makeInstructor } from "./helpers/fixtures";

const form = {
  email: "Jiwoo@Example.com",
  password: "study-2026",
  name: "김지우",
  phone: "010-1234-5678",
  agree_terms: true,
  agree_privacy: true,
};

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

const withCookie = (name: string, token: string | undefined) =>
  new Request("http://localhost/x", { headers: { cookie: `${name}=${token ?? ""}` } });

describe("회원", () => {
  it("signup → me → logout", async () => {
    const r = await call(signup, { body: form });
    expect(r.status).toBe(201);
    expect(r.body.user.email).toBe("jiwoo@example.com");
    expect(r.body.user.phone).toBe("01012345678");
    expect(USER_COOKIE).toBe("so_session");
    const token = r.cookie(USER_COOKIE);
    expect(token).toBeTruthy();

    const m = await call(me, { cookies: { [USER_COOKIE]: token } });
    expect(m.status).toBe(200);
    expect(m.body.user.name).toBe("김지우");
    expect(m.body.user.password_hash).toBeUndefined();

    await call(logout, { method: "POST", cookies: { [USER_COOKIE]: token } });
    expect((await call(me, { cookies: { [USER_COOKIE]: token } })).status).toBe(401);
  });

  it("duplicate email 409", async () => {
    await call(signup, { body: form });
    const r = await call(signup, { body: { ...form, email: "jiwoo@example.com" } });
    expect(r.status).toBe(409);
  });

  it("short password 400", async () => {
    const r = await call(signup, { body: { ...form, password: "short" } });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe("비밀번호는 8자 이상으로 정해 주세요.");
    expect((await call(signup, { body: { ...form, email: "c@d.com", agree_terms: false } })).status).toBe(400);
  });

  it("password not stored raw", async () => {
    await call(signup, { body: form });
    const u = await db.user.findFirstOrThrow();
    expect(u.password_hash).not.toContain(form.password);
    expect(u.password_hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(form.password, u.password_hash)).toBe(true);
    expect(await verifyPassword("other-pass", u.password_hash)).toBe(false);
  });

  it("login sets cookie, wrong password 401", async () => {
    await call(signup, { body: form });
    const ok = await call(login, { body: { email: form.email, password: form.password } });
    expect(ok.status).toBe(200);
    expect(ok.cookie(USER_COOKIE)).toBeTruthy();
    expect((await call(login, { body: { email: form.email, password: "wrong-pass" } })).status).toBe(401);
  });
});

describe("직원", () => {
  async function makeStaff(role: "admin" | "cs" | "content") {
    return db.staff.create({
      data: { email: `${role}@studyon.test`, name: role, role, password_hash: await hashPassword("staff-pass-1") },
    });
  }

  it("staff login → me → logout", async () => {
    await makeStaff("cs");
    const r = await call(adminLogin, { body: { email: "cs@studyon.test", password: "staff-pass-1" } });
    expect(r.status).toBe(200);
    expect(STAFF_COOKIE).toBe("so_staff");
    const token = r.cookie(STAFF_COOKIE);
    const m = await call(adminMe, { cookies: { [STAFF_COOKIE]: token } });
    expect(m.body.staff.role).toBe("cs");
    await call(adminLogout, { method: "POST", cookies: { [STAFF_COOKIE]: token } });
    expect((await call(adminMe, { cookies: { [STAFF_COOKIE]: token } })).status).toBe(401);
  });

  it("staff perms", async () => {
    expect((await call(adminMe)).status).toBe(401);
    const cs = await makeStaff("cs");
    const admin = await makeStaff("admin");
    const csReq = withCookie(STAFF_COOKIE, await issueStaffSession(cs.id));
    const adminReq = withCookie(STAFF_COOKIE, await issueStaffSession(admin.id));

    await expect(requireStaff(csReq, "settlements")).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "이 작업은 권한이 없어요.",
    });
    await expect(requireStaff(adminReq, "settlements")).resolves.toMatchObject({ id: admin.id });
    await expect(requireStaff(csReq, "refunds")).resolves.toMatchObject({ id: cs.id });
    await expect(requireStaff(csReq)).resolves.toMatchObject({ id: cs.id });

    expect(can("content", "refunds")).toBe(false);
    expect(can("cs", "refunds")).toBe(true);
  });

  it("role table", () => {
    const all = [
      "catalog", "review_courses", "orders", "refunds", "subscriptions", "students", "instructors", "settlements",
      "live", "support", "content_pages", "ops", "staff", "api_keys", "audit",
    ] as const;
    for (const p of all) expect(can("admin", p)).toBe(true);
    const cs = all.filter((p) => can("cs", p));
    expect(cs.sort()).toEqual(["orders", "refunds", "students", "subscriptions", "support"].sort());
    const content = all.filter((p) => can("content", p));
    expect(content.sort()).toEqual(["catalog", "content_pages", "instructors", "live", "review_courses"].sort());
    for (const p of ["settlements", "ops", "staff", "api_keys", "audit"] as const) {
      expect(can("cs", p)).toBe(false);
      expect(can("content", p)).toBe(false);
    }
  });

  it("inactive staff cannot log in", async () => {
    const s = await makeStaff("admin");
    await db.staff.update({ where: { id: s.id }, data: { active: false } });
    expect((await call(adminLogin, { body: { email: "admin@studyon.test", password: "staff-pass-1" } })).status).toBe(401);
  });
});

describe("강사", () => {
  async function makeInstructorUser() {
    const instructor = await makeInstructor({ slug: "hanbit-coder" });
    const user = await db.instructorUser.create({
      data: {
        email: "instructor+hanbit-coder@studyon.test",
        password_hash: await hashPassword("inst-pass-1"),
        instructor_id: instructor.id,
      },
    });
    return { instructor, user };
  }

  it("instructor login → me → logout", async () => {
    const { instructor } = await makeInstructorUser();
    const r = await call(instructorLogin, {
      body: { email: "instructor+hanbit-coder@studyon.test", password: "inst-pass-1" },
    });
    expect(r.status).toBe(200);
    expect(INSTRUCTOR_COOKIE).toBe("so_instructor");
    const token = r.cookie(INSTRUCTOR_COOKIE);
    const m = await call(instructorMe, { cookies: { [INSTRUCTOR_COOKIE]: token } });
    expect(m.status).toBe(200);
    expect(m.body.instructor.slug).toBe(instructor.slug);
    expect(m.body.user.password_hash).toBeUndefined();
    await call(instructorLogout, { method: "POST", cookies: { [INSTRUCTOR_COOKIE]: token } });
    expect((await call(instructorMe, { cookies: { [INSTRUCTOR_COOKIE]: token } })).status).toBe(401);
  });

  it("instructor cookie separate", async () => {
    const u = await call(signup, { body: form });
    const userToken = u.cookie(USER_COOKIE);
    expect((await call(instructorMe, { cookies: { [USER_COOKIE]: userToken } })).status).toBe(401);
    expect((await call(instructorMe, { cookies: { [INSTRUCTOR_COOKIE]: userToken } })).status).toBe(401);

    const { user, instructor } = await makeInstructorUser();
    const token = await issueInstructorSession(user.id);
    await expect(requireInstructor(withCookie(INSTRUCTOR_COOKIE, token))).resolves.toMatchObject({
      instructor: { id: instructor.id },
    });
    // 강사 쿠키로 회원·직원 화면에 들어갈 수 없다
    expect((await call(me, { cookies: { [USER_COOKIE]: token } })).status).toBe(401);
    await expect(requireStaff(withCookie(STAFF_COOKIE, token))).rejects.toBeInstanceOf(HttpError);
  });

  it("suspended instructor is rejected", async () => {
    const { user, instructor } = await makeInstructorUser();
    const token = await issueInstructorSession(user.id);
    await db.instructor.update({ where: { id: instructor.id }, data: { status: "suspended" } });
    await expect(requireInstructor(withCookie(INSTRUCTOR_COOKIE, token))).rejects.toMatchObject({ status: 401 });
  });
});
