import { afterEach, describe, expect, it } from "vitest";
import { assertSafeTossKeys, getEnv, resetEnvCache } from "@/server/env";
import { log } from "@/server/log";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("설정", () => {
  it("rejects live_ toss key", () => {
    expect(() => assertSafeTossKeys({ TOSS_SECRET_KEY: "live_x" })).toThrow();
    expect(() => assertSafeTossKeys({ TOSS_CLIENT_KEY: "live_ck_x" })).toThrow();
    expect(() => assertSafeTossKeys({ TOSS_SECRET_KEY: "test_sk_x", TOSS_CLIENT_KEY: "test_ck_x" })).not.toThrow();
  });

  it("FAULTS_ENABLED defaults false", () => {
    delete process.env.FAULTS_ENABLED;
    resetEnvCache();
    expect(getEnv().FAULTS_ENABLED).toBe(false);
    process.env.FAULTS_ENABLED = "true";
    resetEnvCache();
    expect(getEnv().FAULTS_ENABLED).toBe(true);
  });

  it("NEXT_PUBLIC_HEARTBEAT_SEC defaults 30", () => {
    delete process.env.NEXT_PUBLIC_HEARTBEAT_SEC;
    resetEnvCache();
    expect(getEnv().NEXT_PUBLIC_HEARTBEAT_SEC).toBe(30);
  });

  it("log scrubs secrets", () => {
    expect(log.scrub({ password: "a", token: "b", nested: { api_key: "c" } })).toEqual({
      password: "[가림]",
      token: "[가림]",
      nested: { api_key: "[가림]" },
    });
  });
});
