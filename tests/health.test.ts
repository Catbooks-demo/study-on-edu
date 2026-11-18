import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as healthz } from "@/app/healthz/route";
import { GET as readyz } from "@/app/readyz/route";
import { db } from "@/server/db";

afterEach(() => vi.restoreAllMocks());

describe("상태 확인", () => {
  it("healthz returns ok", async () => {
    const res = healthz();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("readyz returns ready when db up", async () => {
    const res = await readyz();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready" });
  });

  it("readyz returns 503 when db query fails", async () => {
    vi.spyOn(db, "$queryRaw").mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await readyz();
    expect(res.status).toBe(503);
  });
});
