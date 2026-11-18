import { beforeEach, describe, expect, it } from "vitest";
import { nextCertificateNo, nextCode, nextCourseCode, nextOrderCode } from "@/server/codes";
import { db } from "@/server/db";
import { resetDb } from "./helpers/db";

beforeEach(resetDb);

describe("일련번호", () => {
  it("nextCode counts per key", async () => {
    expect(await nextCode(db, "a")).toBe(1);
    expect(await nextCode(db, "a")).toBe(2);
    expect(await nextCode(db, "b")).toBe(1);
  });

  it("order code format", async () => {
    const now = new Date("2026-11-18T01:00:00Z");
    expect(await nextOrderCode(db, now)).toBe("SO2611180001");
    expect(await nextOrderCode(db, now)).toBe("SO2611180002");
  });

  it("order code resets per KST day", async () => {
    await nextOrderCode(db, new Date("2026-11-18T01:00:00Z"));
    expect(await nextOrderCode(db, new Date("2026-11-18T15:00:00Z"))).toBe("SO2611190001");
  });

  it("20 concurrent codes unique", async () => {
    const now = new Date("2026-11-18T01:00:00Z");
    const codes = await Promise.all(Array.from({ length: 20 }, () => db.$transaction((tx) => nextOrderCode(tx, now))));
    expect(new Set(codes).size).toBe(20);
  });

  it("course code", async () => {
    expect(await db.$transaction((tx) => nextCourseCode(tx, "DEV"))).toBe("SO-DEV-0001");
    expect(await nextCourseCode(db, "DEV")).toBe("SO-DEV-0002");
    expect(await nextCourseCode(db, "EXAM")).toBe("SO-EXAM-0001");
  });

  it("certificate no", async () => {
    const now = new Date("2026-11-18T01:00:00Z");
    expect(await nextCertificateNo(db, now)).toBe("SOC-2026-000001");
    expect(await nextCertificateNo(db, now)).toBe("SOC-2026-000002");
  });
});
