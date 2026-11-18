import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createCoupon } from "@/app/api/v1/coupons/route";
import { GET as listCourses } from "@/app/api/v1/courses/route";
import { GET as listEnrollments } from "@/app/api/v1/enrollments/route";
import { PATCH as updateIncidentV1 } from "@/app/api/v1/incidents/[id]/route";
import { GET as listIncidentsV1, POST as createIncidentV1 } from "@/app/api/v1/incidents/route";
import { POST as answerInquiry } from "@/app/api/v1/inquiries/[id]/answer/route";
import { GET as listInquiries } from "@/app/api/v1/inquiries/route";
import { GET as listInstructors } from "@/app/api/v1/instructors/route";
import { GET as getOrder } from "@/app/api/v1/orders/[code]/route";
import { GET as listOrders } from "@/app/api/v1/orders/route";
import { GET as listPayments } from "@/app/api/v1/payments/route";
import { GET as progress } from "@/app/api/v1/progress/route";
import { GET as listQueuesV1, POST as setQueueV1 } from "@/app/api/v1/queue/route";
import { GET as listRefunds } from "@/app/api/v1/refunds/route";
import { GET as getMode, POST as setModeV1 } from "@/app/api/v1/service-mode/route";
import { GET as listSubscriptions } from "@/app/api/v1/subscriptions/route";
import { issueApiKey, revokeApiKey } from "@/server/apikeys";
import { rateLimit, resetRateLimits } from "@/server/auth/ratelimit";
import { db } from "@/server/db";
import { resetQueueCache } from "@/server/queue";
import { resetModeCache } from "@/server/servicemode";
import { OPENAPI } from "@/server/v1/openapi";
import { maskEmail, maskKo, maskPhone } from "@/server/v1/serialize";
import { resetDb } from "./helpers/db";
import { makeCourse, makePaidOrder, makeSubscription, makeUser } from "./helpers/fixtures";
import { call } from "./helpers/http";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  resetModeCache();
  resetQueueCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const auth = (key: string) => ({ authorization: `Bearer ${key}` });

async function someOrders(n: number) {
  const { course } = await makeCourse();
  const list = [];
  for (let i = 0; i < n; i++) {
    const user = await makeUser();
    const { order, item } = await makePaidOrder(user.id, course.id);
    await db.payment.create({ data: { order_id: order.id, kind: "charge", method: "mock", amount: 99_000, status: "approved", approved_at: new Date() } });
    await db.enrollment.create({ data: { user_id: user.id, course_id: course.id, source: "order", order_item_id: item.id, starts_at: new Date() } });
    list.push({ user, order });
  }
  return { course, list };
}

describe("키와 범위", () => {
  it("401 without key / revoked", async () => {
    expect((await call(listOrders)).status).toBe(401);
    expect((await call(listOrders, { headers: auth("sok_wrong") })).status).toBe(401);
    const k = await issueApiKey("정산", ["read"]);
    expect(k.key.startsWith("sok_")).toBe(true);
    expect((await call(listOrders, { headers: auth(k.key) })).status).toBe(200);
    await revokeApiKey(k.id);
    expect((await call(listOrders, { headers: auth(k.key) })).status).toBe(401);
  });

  it("read key cannot write 403", async () => {
    const k = await issueApiKey("정산", ["read"]);
    expect((await call(setModeV1, { headers: auth(k.key), body: { mode: "degraded", reason: "x" } })).status).toBe(403);
    expect((await call(createIncidentV1, { headers: auth(k.key), body: {} })).status).toBe(403);
    expect((await call(setQueueV1, { headers: auth(k.key), body: { target: "site", enabled: true, rate_per_sec: 5 } })).status).toBe(403);
  });

  it("metrics key cannot read 403", async () => {
    const k = await issueApiKey("프로메테우스", ["metrics"]);
    expect((await call(listOrders, { headers: auth(k.key) })).status).toBe(403);
  });

  it("600/min limit → 429", async () => {
    const k = await issueApiKey("x", ["read"]);
    for (let i = 0; i < 600; i++) rateLimit(`api:${k.id}`, 600, 60);
    const r = await call(listCourses, { headers: auth(k.key) });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
  });
});

describe("개인정보", () => {
  it("read masks PII", async () => {
    const { list } = await someOrders(1);
    const u = list[0].user;
    await makeSubscription(u.id);
    const k = await issueApiKey("정산", ["read"]);
    for (const h of [listOrders, listInquiries, listSubscriptions]) {
      const raw = JSON.stringify((await call(h, { headers: auth(k.key) })).body);
      expect(raw).not.toContain(u.name);
      expect(raw).not.toMatch(/010\d{8}/);
      expect(raw).not.toContain(u.email);
    }
    const raw = JSON.stringify((await call(listOrders, { headers: auth(k.key) })).body);
    expect(raw).toContain(maskKo(u.name));
    expect(raw).toContain("010-****-5678");
    expect(raw).toContain(maskEmail(u.email));
  });

  it("read_pii shows raw", async () => {
    const { list } = await someOrders(1);
    const k = await issueApiKey("ERP", ["read_pii"]);
    const raw = JSON.stringify((await call(listOrders, { headers: auth(k.key) })).body);
    expect(raw).toContain(list[0].user.name);
    expect(raw).toContain(list[0].user.email);
    expect(raw).toContain("01012345678");
  });

  it("never leaks secrets", async () => {
    const { list } = await someOrders(2);
    await db.payment.updateMany({ data: { toss_payment_key: "tgen_secret_key_123" } });
    await db.device.create({ data: { user_id: list[0].user.id, device_key: "dev-key-abc", name: "크롬" } }).catch(() => undefined);
    const k = await issueApiKey("ERP", ["read_pii", "write"]);
    const handlers = [listCourses, listInstructors, listOrders, listPayments, listRefunds, listSubscriptions, listEnrollments, listInquiries, getMode, listQueuesV1, listIncidentsV1];
    for (const h of handlers) {
      const r = await call(h, { headers: auth(k.key) });
      expect(r.status).toBe(200);
      const s = JSON.stringify(r.body);
      expect(s).not.toContain("password_hash");
      expect(s).not.toContain("device_key");
      expect(s).not.toContain("dev-key-abc");
      expect(s.toLowerCase()).not.toContain("token");
      expect(s).not.toContain("tgen_secret_key_123");
      expect(s).not.toContain("scrypt$");
    }
    const one = await call(getOrder, { headers: auth(k.key), params: { code: list[0].order.code } });
    expect(one.status).toBe(200);
    expect(JSON.stringify(one.body)).not.toContain("password_hash");
    expect((await call(getOrder, { headers: auth(k.key), params: { code: "SO0000000000" } })).status).toBe(404);
  });

  it("mask shapes", () => {
    expect(maskKo("김민지")).toBe("김*지");
    expect(maskPhone("01012345678")).toBe("010-****-5678");
    expect(maskEmail("minji@example.com")).toBe("m***@example.com");
  });

  it("unpaid subscription (stored as expired) is hidden", async () => {
    const u = await makeUser();
    const paid = await makeSubscription(u.id);
    await db.subscriptionInvoice.create({
      data: { subscription_id: paid.id, period_start: paid.current_period_start, period_end: paid.current_period_end, amount: 29_000, status: "paid", paid_at: new Date() },
    });
    const u2 = await makeUser();
    const unpaid = await makeSubscription(u2.id);
    await db.subscription.update({ where: { id: unpaid.id }, data: { status: "expired" } });
    await db.subscriptionInvoice.create({
      data: { subscription_id: unpaid.id, period_start: unpaid.current_period_start, period_end: unpaid.current_period_end, amount: 29_000, status: "pending" },
    });
    const k = await issueApiKey("x", ["read"]);
    const r = await call<{ data: { id: string }[] }>(listSubscriptions, { headers: auth(k.key) });
    expect(r.body.data.map((s) => s.id)).toEqual([paid.id]);
  });
});

describe("페이지 나누기", () => {
  it("cursor pages", async () => {
    const { list } = await someOrders(7);
    const k = await issueApiKey("x", ["read"]);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `http://localhost/api/v1/orders?limit=3${cursor ? `&cursor=${cursor}` : ""}`;
      const r = await call<{ data: { code: string }[]; next_cursor: string | null }>(listOrders, { headers: auth(k.key), url });
      seen.push(...r.body.data.map((o) => o.code));
      cursor = r.body.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(list.map((o) => o.order.code).sort());
    expect((await call(listOrders, { headers: auth(k.key), url: "http://localhost/x?limit=500" })).status).toBe(400);
    expect((await call(listOrders, { headers: auth(k.key), url: "http://localhost/x?cursor=@@@" })).status).toBe(400);
  });
});

describe("쓰기 (AXcellent 같은 외부 시스템이 당기는 손잡이)", () => {
  it("service-mode via API needs reason, writes audit api:<name>", async () => {
    const w = await issueApiKey("관제", ["read", "write"]);
    const r0 = await call<{ mode: string; thresholds: unknown; suggestion: unknown; window: unknown }>(getMode, { headers: auth(w.key) });
    expect(r0.status).toBe(200);
    expect(r0.body.mode).toBe("normal");
    expect(r0.body.thresholds).toEqual({ degraded: { error_rate: 0.05, p95_ms: 1500 }, read_only: { error_rate: 0.2, p95_ms: 5000 } });
    expect(r0.body).toHaveProperty("suggestion");
    expect(r0.body).toHaveProperty("window");
    expect((await call(setModeV1, { headers: auth(w.key), body: { mode: "degraded", reason: " " } })).status).toBe(400);
    expect((await call(setModeV1, { headers: auth(w.key), body: { mode: "degraded", reason: "p95 급증" } })).status).toBe(200);
    resetModeCache();
    expect((await call<{ mode: string }>(getMode, { headers: auth(w.key) })).body.mode).toBe("degraded");
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "service_mode.set" } });
    expect(a.actor).toBe("api:관제");
  });

  it("incidents via API: create, list, resolve", async () => {
    const w = await issueApiKey("관제", ["read", "write"]);
    const c = await call<{ incident: { id: string } }>(createIncidentV1, {
      headers: auth(w.key),
      body: { title: "결제 지연", body: "확인 중이에요.", components: ["payments"], severity: "degraded" },
    });
    expect(c.status).toBe(201);
    const l = await call<{ data: { id: string; status: string }[] }>(listIncidentsV1, { headers: auth(w.key) });
    expect(l.body.data[0].id).toBe(c.body.incident.id);
    const u = await call(updateIncidentV1, { method: "PATCH", headers: auth(w.key), params: { id: c.body.incident.id }, body: { status: "resolved", body: "해결했어요." } });
    expect(u.status).toBe(200);
    expect(await db.auditLog.count({ where: { actor: "api:관제", action: { startsWith: "incident." } } })).toBe(2);
  });

  it("queue via API: turn site on during a spike", async () => {
    const w = await issueApiKey("관제", ["read", "write"]);
    expect((await call(setQueueV1, { headers: auth(w.key), body: { target: "site", enabled: true, rate_per_sec: 0 } })).status).toBe(400);
    const r = await call(setQueueV1, { headers: auth(w.key), body: { target: "site", enabled: true, rate_per_sec: 30 } });
    expect(r.status).toBe(200);
    const l = await call<{ data: { target: string; enabled: boolean; rate_per_sec: number; waiting: number }[] }>(listQueuesV1, { headers: auth(w.key) });
    expect(l.body.data).toEqual([expect.objectContaining({ target: "site", enabled: true, rate_per_sec: 30, waiting: 0 })]);
    expect(await db.auditLog.count({ where: { actor: "api:관제", action: "queue.update" } })).toBe(1);
  });

  it("coupon create (referral not allowed)", async () => {
    const w = await issueApiKey("마케팅", ["write"]);
    const body = { code: "SPRING15", kind: "percent", value: 15, max_discount: 20_000, target: "all", starts_at: "2026-12-01T00:00:00Z", ends_at: "2026-12-31T15:00:00Z" };
    const r = await call<{ coupon: { code: string } }>(createCoupon, { headers: auth(w.key), body });
    expect(r.status).toBe(201);
    expect(r.body.coupon.code).toBe("SPRING15");
    expect((await call(createCoupon, { headers: auth(w.key), body })).status).toBe(409);
    expect((await call(createCoupon, { headers: auth(w.key), body: { ...body, code: "REF1", referral: true } })).status).toBe(400);
    expect((await call(createCoupon, { headers: auth(w.key), body: { ...body, code: "BAD1", value: 150 } })).status).toBe(400);
    expect(await db.auditLog.count({ where: { actor: "api:마케팅", action: "coupon.create" } })).toBe(1);
  });

  it("M4 endpoints not on dev yet answer 501", async () => {
    const w = await issueApiKey("x", ["read", "write"]);
    const p = await call(progress, { headers: auth(w.key) });
    expect(p.status).toBe(501);
    expect(p.body.error.code).toBe("NOT_IMPLEMENTED");
    const a = await call(answerInquiry, { headers: auth(w.key), params: { id: "x" }, body: { answer: "안녕하세요" } });
    expect(a.status).toBe(501);
  });
});

describe("OpenAPI", () => {
  it("openapi covers every route file", () => {
    const root = join(process.cwd(), "src", "app", "api", "v1");
    const routes = (readdirSync(root, { recursive: true }) as string[])
      .filter((f) => f.endsWith("route.ts") && !f.startsWith("openapi.json"))
      .map((f) => `/api/v1/${relative(".", f).split(sep).slice(0, -1).join("/")}`.replace(/\[(\w+)\]/g, "{$1}"));
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) expect(Object.keys(OPENAPI.paths), r).toContain(r);
    expect(Object.keys(OPENAPI.paths)).toContain("/metrics");
    expect(OPENAPI.info.title).toBe("스터디온에듀 외부 시스템 API");
  });
});
