import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listRoute, POST as createRoute } from "@/app/api/admin/webhooks/route";
import { POST as testRoute } from "@/app/api/admin/webhooks/[id]/test/route";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { STAFF_COOKIE, issueStaffSession } from "@/server/auth/session";
import { addToCart } from "@/server/cart";
import { db } from "@/server/db";
import { createOrder } from "@/server/orders";
import { mockPay } from "@/server/payments";
import { resetModeCache, setMode } from "@/server/servicemode";
import { createIncident } from "@/server/status";
import { RETRY_MIN, createEndpoint, deliverWebhooks, emitEvent, sign } from "@/server/webhooks";
import { resetDb } from "./helpers/db";
import { makeCourse, makeStaff, makeUser } from "./helpers/fixtures";
import { call } from "./helpers/http";

const MIN = 60_000;

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  resetModeCache();
});
afterEach(() => vi.restoreAllMocks());

type Sent = { url: string; headers: Record<string, string>; body: string };
function fakeFetch(status = 200) {
  const sent: Sent[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: String(init?.body) });
    return new Response("ok", { status });
  });
  return { f: f as unknown as typeof fetch, sent, calls: () => f.mock.calls.length };
}

async function paidOrder() {
  const user = await makeUser();
  const { course } = await makeCourse({ price: 30_000 });
  await addToCart(user.id, { course_code: course.code });
  const order = await createOrder(user.id, {});
  await mockPay(order.code);
  return { user, course, order };
}

describe("웹훅", () => {
  it("paid order enqueues one delivery", async () => {
    await createEndpoint("system", { url: "https://hooks.example.com/a", events: ["order.paid"] });
    await createEndpoint("system", { url: "https://hooks.example.com/b", events: ["order.refunded"] });
    const { order } = await paidOrder();
    const rows = await db.webhookDelivery.findMany();
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe("order.paid");
    expect(rows[0].status).toBe("pending");
    const p = rows[0].payload as { id: string; type: string; data: { order_code: string } };
    expect(p.id).toMatch(/^evt_/);
    expect(p.type).toBe("order.paid");
    expect(p.data.order_code).toBe(order.code);
  });

  it("rollback drops delivery", async () => {
    await createEndpoint("system", { url: "https://hooks.example.com/a", events: ["order.paid"] });
    await expect(
      db.$transaction(async (tx) => {
        await emitEvent(tx, "order.paid", { order_code: "SOX" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await db.webhookDelivery.count()).toBe(0);
  });

  it("signature verifies", async () => {
    const { secret } = await createEndpoint("system", { url: "https://hooks.example.com/a", events: ["service_mode.changed"] });
    expect(secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    const admin = await makeStaff("admin");
    await setMode(`staff:${admin.id}`, "degraded", "접속 폭주");
    const { f, sent } = fakeFetch(200);
    const r = await deliverWebhooks(new Date(Date.now() + 1000), f);
    expect(r).toEqual({ sent: 1, failed: 0 });
    const h = sent[0].headers;
    expect(h["x-studyon-event"]).toBe("service_mode.changed");
    expect(h["x-studyon-delivery"]).toBeTruthy();
    const m = h["x-studyon-signature"].match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    expect(m).not.toBeNull();
    const expectHex = createHmac("sha256", secret).update(`${m![1]}.${sent[0].body}`).digest("hex");
    expect(m![2]).toBe(expectHex);
    expect(sign(secret, Number(m![1]), sent[0].body)).toBe(expectHex);
    const body = JSON.parse(sent[0].body);
    expect(body.data).toMatchObject({ from: "normal", to: "degraded", reason: "접속 폭주" });
    expect((await db.webhookDelivery.findFirstOrThrow()).status).toBe("done");
  });

  it("retry schedule", async () => {
    expect(RETRY_MIN).toEqual([1, 5, 30, 120, 720]);
    await createEndpoint("system", { url: "https://hooks.example.com/a", events: ["incident.created"] });
    const admin = await makeStaff("admin");
    await createIncident(`staff:${admin.id}`, { title: "결제 지연", body: "확인 중", components: ["payments"], severity: "degraded" });
    const { f } = fakeFetch(500);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = new Date(Date.now() + 1000);
    for (const [i, gap] of RETRY_MIN.entries()) {
      const r = await deliverWebhooks(now, f);
      expect(r.failed).toBe(1);
      const d = await db.webhookDelivery.findFirstOrThrow();
      expect(d.status).toBe("pending");
      expect(d.attempts).toBe(i + 1);
      expect(d.last_status).toBe(500);
      expect(d.next_attempt_at.getTime()).toBe(now.getTime() + gap * MIN);
      // 다음 시각 전에는 다시 보내지 않는다
      expect(await deliverWebhooks(new Date(now.getTime() + gap * MIN - 1000), f)).toEqual({ sent: 0, failed: 0 });
      now = new Date(now.getTime() + gap * MIN);
    }
    const r6 = await deliverWebhooks(now, f);
    expect(r6.failed).toBe(1);
    const d = await db.webhookDelivery.findFirstOrThrow();
    expect(d.status).toBe("failed");
    expect(d.attempts).toBe(6);
  });

  it("two runners deliver once", async () => {
    await createEndpoint("system", { url: "https://hooks.example.com/a", events: ["order.paid"] });
    await paidOrder();
    const { f, calls } = fakeFetch(200);
    const now = new Date(Date.now() + 1000);
    const [a, b] = await Promise.all([deliverWebhooks(now, f), deliverWebhooks(now, f)]);
    expect(calls()).toBe(1);
    expect(a.sent + b.sent).toBe(1);
  });

  it("payload masks PII", async () => {
    await createEndpoint("system", { url: "https://hooks.example.com/a", events: ["order.paid"] });
    const { user } = await paidOrder();
    const { f, sent } = fakeFetch(200);
    await deliverWebhooks(new Date(Date.now() + 1000), f);
    expect(sent[0].body).not.toContain(user.name);
    expect(sent[0].body).not.toContain(user.email);
    expect(sent[0].body).not.toContain(user.phone);
    expect(sent[0].body).toContain("010-****-5678");
  });

  it("secret never logged", async () => {
    const lines: string[] = [];
    for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    const { secret, endpoint } = await createEndpoint("system", { url: "https://hooks.example.com/a", events: ["order.paid"] });
    await paidOrder();
    await deliverWebhooks(new Date(Date.now() + 1000), fakeFetch(500).f);
    await deliverWebhooks(new Date(Date.now() + 2 * MIN), fakeFetch(200).f);
    const failing = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    await db.webhookDelivery.updateMany({ data: { status: "pending", next_attempt_at: new Date() } });
    await deliverWebhooks(new Date(Date.now() + 3 * MIN), failing);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toContain(secret);
    const audits = JSON.stringify(await db.auditLog.findMany());
    expect(audits).not.toContain(secret);
    expect(audits).toContain(secret.slice(0, 10));
    expect(endpoint.id).toBeTruthy();
  });

  it("subscription status change emits event", async () => {
    await createEndpoint("system", { url: "https://hooks.example.com/a", events: ["subscription.status_changed"] });
    const { emitSubscriptionStatus } = await import("@/server/webhooks");
    const user = await makeUser();
    await db.$transaction((tx) => emitSubscriptionStatus(tx, { id: "sub1", user_id: user.id }, "active", "past_due"));
    const d = await db.webhookDelivery.findFirstOrThrow();
    expect(d.type).toBe("subscription.status_changed");
    expect((d.payload as { data: object }).data).toMatchObject({ subscription_id: "sub1", from: "active", to: "past_due" });
  });

  it("endpoint rules and admin API", async () => {
    await expect(createEndpoint("system", { url: "http://hooks.example.com/a", events: ["order.paid"] })).rejects.toMatchObject({ status: 400 });
    await expect(createEndpoint("system", { url: "https://hooks.example.com/a", events: ["nope"] })).rejects.toMatchObject({ status: 400 });
    await expect(createEndpoint("system", { url: "http://localhost:4000/hook", events: ["order.paid"] })).resolves.toBeTruthy();

    const cs = await makeStaff("cs");
    const admin = await makeStaff("admin");
    const csCookie = { [STAFF_COOKIE]: await issueStaffSession(cs.id) };
    const adminCookie = { [STAFF_COOKIE]: await issueStaffSession(admin.id) };
    const body = { url: "https://hooks.example.com/z", events: ["order.paid", "incident.created"] };
    expect((await call(createRoute, { body, cookies: csCookie })).status).toBe(403);
    const c = await call<{ endpoint: { id: string; secret_prefix: string }; secret: string }>(createRoute, { body, cookies: adminCookie });
    expect(c.status).toBe(201);
    expect(c.body.secret.startsWith(c.body.endpoint.secret_prefix)).toBe(true);
    const l = await call(listRoute, { cookies: adminCookie });
    expect(JSON.stringify(l.body)).not.toContain(c.body.secret);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const t = await call<{ status: string }>(testRoute, { params: { id: c.body.endpoint.id }, cookies: adminCookie, body: {} });
    expect(t.status).toBe(200);
    expect(await db.webhookDelivery.count({ where: { endpoint_id: c.body.endpoint.id, type: "ping" } })).toBe(1);
  });
});
