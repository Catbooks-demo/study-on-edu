import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StatusPage from "@/app/(site)/status/page";
import { POST as createRoute } from "@/app/api/admin/ops/incidents/route";
import { PATCH as updateRoute } from "@/app/api/admin/ops/incidents/[id]/route";
import { STAFF_COOKIE, issueStaffSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { COMPONENTS, STATUS_LABEL, componentStatus, createIncident, updateIncident } from "@/server/status";
import { resetDb } from "./helpers/db";
import { makeStaff } from "./helpers/fixtures";
import { call } from "./helpers/http";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const statusOf = (rows: Awaited<ReturnType<typeof componentStatus>>, c: string) => rows.find((r) => r.component === c)!;

describe("상태 페이지", () => {
  it("all operational without incidents", async () => {
    const rows = await componentStatus(new Date());
    expect(rows.map((r) => r.component)).toEqual([...COMPONENTS]);
    expect(rows.every((r) => r.status === "operational")).toBe(true);
  });

  it("open outage incident on payments → payments outage, others operational", async () => {
    const admin = await makeStaff("admin");
    await createIncident(`staff:${admin.id}`, { title: "결제 지연", body: "결제 승인이 늦어요.", components: ["payments"], severity: "outage" });
    await createIncident(`staff:${admin.id}`, { title: "결제 느림", body: "느려요.", components: ["payments"], severity: "degraded" });
    const rows = await componentStatus(new Date());
    expect(statusOf(rows, "payments").status).toBe("outage");
    expect(statusOf(rows, "payments").incident?.title).toBe("결제 지연");
    for (const c of ["web", "player", "live", "api"]) expect(statusOf(rows, c).status).toBe("operational");
    expect(await db.auditLog.count({ where: { action: "incident.create" } })).toBe(2);
  });

  it("resolved incident ignored", async () => {
    const admin = await makeStaff("admin");
    const inc = await createIncident(`staff:${admin.id}`, { title: "재생 끊김", body: "확인 중", components: ["player"], severity: "degraded" });
    expect(statusOf(await componentStatus(new Date()), "player").status).toBe("degraded");
    await updateIncident(`staff:${admin.id}`, inc.id, { status: "resolved", body: "해결했어요." });
    const after = await db.incident.findUniqueOrThrow({ where: { id: inc.id } });
    expect(after.resolved_at).not.toBeNull();
    expect(statusOf(await componentStatus(new Date()), "player").status).toBe("operational");
    expect(await db.auditLog.count({ where: { action: "incident.update" } })).toBe(1);
  });

  it("db down → every component outage", async () => {
    vi.spyOn(db, "$queryRaw").mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = await componentStatus(new Date());
    expect(rows.every((r) => r.status === "outage")).toBe(true);
  });

  it("/status renders without login", async () => {
    const html = renderToStaticMarkup(await StatusPage());
    expect(html).toContain("서비스 상태");
    expect(html).toContain(STATUS_LABEL.operational);
    expect(html).toContain("정상이에요");
  });

  it("/status shows an open incident", async () => {
    const admin = await makeStaff("admin");
    await createIncident(`staff:${admin.id}`, { title: "라이브 접속 오류", body: "입장이 안 돼요.", components: ["live"], severity: "outage" });
    const html = renderToStaticMarkup(await StatusPage());
    expect(html).toContain("라이브 접속 오류");
    expect(html).toContain("장애가 있어요");
  });
});

describe("장애 공지 API", () => {
  it("admin only, validates input", async () => {
    const cs = await makeStaff("cs");
    const admin = await makeStaff("admin");
    const csCookie = { [STAFF_COOKIE]: await issueStaffSession(cs.id) };
    const adminCookie = { [STAFF_COOKIE]: await issueStaffSession(admin.id) };
    const body = { title: "점검", body: "확인 중이에요.", components: ["web"], severity: "degraded" };
    expect((await call(createRoute, { body })).status).toBe(401);
    expect((await call(createRoute, { body, cookies: csCookie })).status).toBe(403);
    expect((await call(createRoute, { body: { ...body, components: ["nope"] }, cookies: adminCookie })).status).toBe(400);
    const ok = await call<{ incident: { id: string } }>(createRoute, { body, cookies: adminCookie });
    expect(ok.status).toBe(201);
    const up = await call(updateRoute, {
      method: "PATCH",
      body: { status: "monitoring", body: "지켜보는 중이에요." },
      params: { id: ok.body.incident.id },
      cookies: adminCookie,
    });
    expect(up.status).toBe(200);
    expect((await db.incident.findUniqueOrThrow({ where: { id: ok.body.incident.id } })).status).toBe("monitoring");
  });
});
