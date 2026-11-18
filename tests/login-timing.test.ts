import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@/server/auth/password";
import { instructorLogin, login, staffLogin } from "@/server/auth/users";
import { db } from "@/server/db";
import { resetDb } from "./helpers/db";

// 로그인 시간 차로 가입 여부가 새지 않게: 계정이 없어도 비밀번호 검사(scrypt)를 한 번 한다.
vi.mock("@/server/auth/password", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/server/auth/password")>();
  return { ...orig, verifyPassword: vi.fn(orig.verifyPassword) };
});

const spy = vi.mocked(verifyPassword);

beforeEach(async () => {
  await resetDb();
  spy.mockClear();
});

describe("로그인 시간 차", () => {
  it("missing user still verifies a dummy hash", async () => {
    await expect(login("nobody@studyon.test", "whatever-pass")).rejects.toMatchObject({ status: 401 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatch(/^scrypt\$/);
  });

  it("missing staff still verifies a dummy hash", async () => {
    await expect(staffLogin("nobody@studyon.test", "whatever-pass")).rejects.toMatchObject({ status: 401 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("inactive staff still verifies (same time as wrong password)", async () => {
    await db.staff.create({ data: { email: "off@studyon.test", name: "꺼진 직원", role: "cs", password_hash: "scrypt$test", active: false } });
    await expect(staffLogin("off@studyon.test", "whatever-pass")).rejects.toMatchObject({ status: 401 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("missing instructor still verifies a dummy hash", async () => {
    await expect(instructorLogin("nobody@studyon.test", "whatever-pass")).rejects.toMatchObject({ status: 401 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
