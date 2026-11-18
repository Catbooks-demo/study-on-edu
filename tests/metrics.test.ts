import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as metricsRoute } from "@/app/metrics/route";
import { issueApiKey, revokeApiKey } from "@/server/apikeys";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { route } from "@/server/http";
import { recentWindow, recordRequest, renderMetrics, resetMetrics, routeGroup } from "@/server/metrics";
import { resetDb } from "./helpers/db";
import { makeUser } from "./helpers/fixtures";
import { call } from "./helpers/http";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  resetMetrics();
});
afterEach(() => vi.restoreAllMocks());

const auth = (key: string) => ({ authorization: `Bearer ${key}` });

describe("경로 묶음", () => {
  it("routeGroup replaces ids and codes", () => {
    expect(routeGroup("/api/player/lectures/clx123/download")).toBe("/api/player/lectures/:id/download");
    expect(routeGroup("/api/orders/SO2611180001/coupon")).toBe("/api/orders/:id/coupon");
    expect(routeGroup("/courses/SO-DEV-0001")).toBe("/courses/:id");
    expect(routeGroup("/api/v1/orders")).toBe("/api/v1/orders");
    expect(routeGroup("/healthz")).toBe("/healthz");
  });
});

describe("지표", () => {
  it("histogram buckets cumulative", async () => {
    recordRequest("/hist", "GET", 200, 30);
    recordRequest("/hist", "GET", 200, 300);
    recordRequest("/hist", "GET", 200, 3000);
    const text = await renderMetrics(new Date());
    expect(text).toContain('studyon_http_request_duration_seconds_bucket{group="/hist",le="0.05"} 1');
    expect(text).toContain('studyon_http_request_duration_seconds_bucket{group="/hist",le="0.5"} 2');
    expect(text).toContain('studyon_http_request_duration_seconds_bucket{group="/hist",le="+Inf"} 3');
    expect(text).toContain('studyon_http_request_duration_seconds_count{group="/hist"} 3');
    expect(text).toMatch(/studyon_http_request_duration_seconds_sum\{group="\/hist"\} 3\.33/);
  });

  it("5xx counted", async () => {
    const boom = route(async () => {
      throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await call(boom, { url: "http://localhost/api/boom/abc123" });
    expect(r.status).toBe(500);
    const text = await renderMetrics(new Date());
    expect(text).toContain('studyon_http_requests_total{group="/api/boom/:id",method="GET",status="500"} 1');
    expect(recentWindow(new Date()).error_rate).toBe(1);
  });

  it("/metrics 401 without key, 403 for read key, 200 with metrics scope", async () => {
    expect((await call(metricsRoute)).status).toBe(401);
    const read = await issueApiKey("읽기", ["read"]);
    expect((await call(metricsRoute, { headers: auth(read.key) })).status).toBe(403);
    const m = await issueApiKey("프로메테우스", ["metrics"]);
    const res = await metricsRoute(new Request("http://localhost/metrics", { headers: auth(m.key) }), {} as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("studyon_active_playbacks");
    expect(text).toContain("studyon_db_connections");
    expect(text).toContain("studyon_db_slow_queries_total");
    await revokeApiKey(m.id);
    expect((await call(metricsRoute, { headers: auth(m.key) })).status).toBe(401);
  });

  it("no PII in metrics", async () => {
    await makeUser({ email: "secret.person@example.com" });
    recordRequest("/api/auth/login", "POST", 401, 12);
    const text = await renderMetrics(new Date());
    expect(text).not.toContain("@");
  });

  it("request log line has req_id, group, status and no cookie or query", async () => {
    const ok = route(async () => Response.json({ ok: true }));
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => {
      lines.push(String(s));
    });
    const r = await call(ok, {
      url: "http://localhost/api/orders/SO2611180001?token=abc&email=a@b.c",
      cookies: { so_session: "very-secret-session" },
    });
    expect(r.status).toBe(200);
    const line = lines.find((l) => l.includes('"요청"'));
    expect(line).toBeDefined();
    const j = JSON.parse(line!);
    expect(j.req_id).toBeTruthy();
    expect(j.group).toBe("/api/orders/:id");
    expect(j.status).toBe(200);
    expect(j.method).toBe("GET");
    expect(typeof j.ms).toBe("number");
    expect(line).not.toContain("cookie");
    expect(line).not.toContain("very-secret-session");
    expect(line).not.toContain("?");
    expect(line).not.toContain("token=abc");
    expect(r.headers.get("x-request-id")).toBe(j.req_id);
  });

  it("keeps a safe incoming x-request-id", async () => {
    const ok = route(async () => Response.json({ ok: true }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await call(ok, { headers: { "x-request-id": "abc-123_def" } });
    expect(r.headers.get("x-request-id")).toBe("abc-123_def");
    const bad = await call(ok, { headers: { "x-request-id": "bad id with spaces <script>" } });
    expect(bad.headers.get("x-request-id")).not.toContain("bad id");
  });
});
