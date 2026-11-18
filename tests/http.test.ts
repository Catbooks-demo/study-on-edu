import { beforeEach, describe, expect, it } from "vitest";
import { GET as adminMe } from "@/app/api/admin/auth/me/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { GET as instructorMe } from "@/app/api/instructor/auth/me/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { readCookie } from "@/server/http";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";

const withCookie = (cookie: string) => new Request("http://localhost/x", { headers: { cookie } });

describe("readCookie", () => {
  it("reads and decodes a cookie", () => {
    expect(readCookie(withCookie("a=1; so_session=ab%2Fcd"), "so_session")).toBe("ab/cd");
    expect(readCookie(withCookie("a=1"), "so_session")).toBeUndefined();
  });

  it("malformed percent-encoding is treated as missing, not thrown", () => {
    expect(() => readCookie(withCookie("so_session=%E0%A4%A"), "so_session")).not.toThrow();
    expect(readCookie(withCookie("so_session=%E0%A4%A"), "so_session")).toBeUndefined();
    expect(readCookie(withCookie("so_session=%"), "so_session")).toBeUndefined();
  });
});

describe("malformed session cookies", () => {
  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
  });

  it("me answers 401, not 500", async () => {
    expect((await call(me, { headers: { cookie: "so_session=%E0%A4%A" } })).status).toBe(401);
    expect((await call(adminMe, { headers: { cookie: "so_staff=%E0%A4%A" } })).status).toBe(401);
    expect((await call(instructorMe, { headers: { cookie: "so_instructor=%" } })).status).toBe(401);
  });

  it("logout with a malformed cookie still succeeds", async () => {
    const r = await call(logout, { method: "POST", headers: { cookie: "so_session=%E0%A4%A" } });
    expect(r.status).toBeLessThan(500);
  });
});
