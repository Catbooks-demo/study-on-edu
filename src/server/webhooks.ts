import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Prisma, WebhookDelivery, WebhookEndpoint } from "@prisma/client";
import { audit } from "./audit";
import { db } from "./db";
import { HttpError } from "./http";
import { log } from "./log";
import type { Tx } from "./tx";

/**
 * 웹훅 (플랫폼 자기 규격). 이벤트는 바뀐 일과 같은 트랜잭션에서 webhook_deliveries에 쌓이고(outbox),
 * 커밋된 뒤 주기 작업 deliverWebhooks가 보낸다. 롤백되면 같이 사라진다.
 * 본문 `{id: evt_<uuid>, type, created_at, data}`, data에는 read 범위처럼 가린 개인정보만 담는다.
 */
export const WEBHOOK_EVENTS = [
  "order.paid",
  "order.refunded",
  "subscription.status_changed",
  "service_mode.changed",
  "incident.created",
  "incident.updated",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const EVENT_KO: Record<WebhookEvent, string> = {
  "order.paid": "주문 결제",
  "order.refunded": "주문 환불 완료",
  "subscription.status_changed": "구독 상태 바뀜",
  "service_mode.changed": "서비스 모드 바뀜",
  "incident.created": "장애 공지 올림",
  "incident.updated": "장애 공지 바뀜",
};

/** 실패하면 이 순서(분)로 다시 보낸다. 6번째 실패면 failed. */
export const RETRY_MIN = [1, 5, 30, 120, 720] as const;
export const TIMEOUT_MS = 5_000;
const BATCH = 50;
/** 보내는 동안 다른 작업이 같은 행을 잡지 않게 미뤄 두는 시간. */
const LEASE_MS = 5 * 60_000;

// ── 서명 ──
/** hex HMAC-SHA256(secret, `${t}.${body}`). 헤더는 `X-StudyOn-Signature: t=<unix초>,v1=<이 값>`. */
export function sign(secret: string, t: number, body: string): string {
  return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
}

// ── 쌓기 ──
/** 그 type을 구독한 활성 주소마다 배달 행을 만든다 (부르는 쪽 트랜잭션). 만든 수. */
export async function emitEvent(tx: Tx, type: WebhookEvent | "ping", data: Record<string, unknown>, now: Date = new Date(), only?: string): Promise<number> {
  const endpoints = await tx.webhookEndpoint.findMany({
    where: only ? { id: only } : { active: true, events: { has: type } },
    select: { id: true },
  });
  if (!endpoints.length) return 0;
  const id = `evt_${randomUUID()}`;
  const payload = { id, type, created_at: now.toISOString(), data } as Prisma.InputJsonValue;
  await tx.webhookDelivery.createMany({
    data: endpoints.map((e) => ({ endpoint_id: e.id, event_id: id, type, payload, next_attempt_at: now })),
    skipDuplicates: true,
  });
  return endpoints.length;
}

/** 구독 상태 이벤트 (hooks.onSubscriptionStatus가 부른다). */
export function emitSubscriptionStatus(tx: Tx, sub: { id: string; user_id: string }, from: string, to: string, now: Date = new Date()) {
  return emitEvent(tx, "subscription.status_changed", { subscription_id: sub.id, member_id: sub.user_id, from, to, at: now.toISOString() }, now);
}

// ── 보내기 ──
type Outcome = { ok: boolean; status: number | null; error?: string };

async function post(endpoint: WebhookEndpoint, d: WebhookDelivery, fetchImpl: typeof fetch, now: Date): Promise<Outcome> {
  const body = JSON.stringify(d.payload);
  const t = Math.floor(now.getTime() / 1000);
  try {
    const res = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "StudyOnEdu-Webhooks/1",
        "X-StudyOn-Event": d.type,
        "X-StudyOn-Delivery": d.id,
        "X-StudyOn-Signature": `t=${t},v1=${sign(endpoint.secret, t, body)}`,
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => undefined);
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, status: null, error: timeout ? "시간 초과(5초)" : e instanceof Error ? e.message.slice(0, 200) : "보내기 실패" };
  }
}

async function finish(d: WebhookDelivery, r: Outcome, now: Date): Promise<void> {
  const attempts = d.attempts + 1;
  if (r.ok) {
    await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "done", attempts, last_status: r.status } });
    log.info("웹훅 보냄", { delivery_id: d.id, type: d.type, endpoint_id: d.endpoint_id, status: r.status, attempts });
    return;
  }
  const failed = attempts > RETRY_MIN.length;
  const next = failed ? d.next_attempt_at : new Date(now.getTime() + RETRY_MIN[attempts - 1] * 60_000);
  await db.webhookDelivery.update({
    where: { id: d.id },
    data: { status: failed ? "failed" : "pending", attempts, last_status: r.status, next_attempt_at: next },
  });
  log.warn("웹훅 실패", {
    delivery_id: d.id,
    type: d.type,
    endpoint_id: d.endpoint_id,
    status: r.status,
    error: r.error,
    attempts,
    next_attempt_at: failed ? null : next.toISOString(),
  });
}

/**
 * 보낼 차례인 배달(pending, next_attempt_at ≤ now)을 최대 50개 잡아 보낸다.
 * 잡을 때 FOR UPDATE SKIP LOCKED로 행을 잠그고 다음 시도 시각을 미뤄 두므로, 작업 둘이 겹쳐도 한 번만 보낸다.
 * 2xx면 done, 아니면 1·5·30·120·720분 뒤 다시, 6번째 실패면 failed.
 */
export async function deliverWebhooks(now: Date, fetchImpl: typeof fetch = fetch): Promise<{ sent: number; failed: number }> {
  const claimed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM webhook_deliveries
      WHERE status = 'pending' AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at, id
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const list = await tx.webhookDelivery.findMany({ where: { id: { in: ids } }, include: { endpoint: true }, orderBy: { next_attempt_at: "asc" } });
    await tx.webhookDelivery.updateMany({ where: { id: { in: ids } }, data: { next_attempt_at: new Date(now.getTime() + LEASE_MS) } });
    return list;
  });
  let sent = 0;
  let failed = 0;
  for (const d of claimed) {
    const r = d.endpoint.active ? await post(d.endpoint, d, fetchImpl, now) : { ok: false, status: null, error: "꺼진 주소" };
    await finish(d, r, now);
    if (r.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

/** 주기 작업용: 보낸 수. */
export async function deliverWebhooksJob(now: Date): Promise<number> {
  const r = await deliverWebhooks(now);
  return r.sent;
}

// ── 주소 관리 (admin) ──
const isLocal = (u: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);

function checkUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "BAD_URL", "주소 형식이 올바르지 않아요.");
  }
  const dev = process.env.NODE_ENV !== "production";
  if (u.protocol === "https:" || (dev && u.protocol === "http:" && isLocal(u))) {
    if (u.username || u.password) throw new HttpError(400, "BAD_URL", "주소에 아이디·비밀번호를 넣지 말아 주세요.");
    return u.toString();
  }
  throw new HttpError(400, "BAD_URL", "https 주소만 등록할 수 있어요 (개발 중에는 http://localhost도 돼요).");
}

function checkEvents(events: unknown): WebhookEvent[] {
  const list = Array.isArray(events) ? [...new Set(events)] : [];
  if (!list.length || list.some((e) => !(WEBHOOK_EVENTS as readonly unknown[]).includes(e))) {
    throw new HttpError(400, "BAD_EVENTS", `이벤트를 하나 이상 골라 주세요 (${WEBHOOK_EVENTS.join(", ")}).`);
  }
  return list as WebhookEvent[];
}

export const secretPrefix = (s: string) => s.slice(0, 10);

export const endpointView = (e: WebhookEndpoint) => ({
  id: e.id,
  url: e.url,
  events: e.events,
  active: e.active,
  secret_prefix: secretPrefix(e.secret),
  created_at: e.created_at.toISOString(),
  updated_at: e.updated_at.toISOString(),
});

/**
 * 주소 등록. secret `whsec_` + 32바이트(hex)를 만든다. 원문은 이때 한 번만 돌려주고(서명에 필요해 DB에도 둔다),
 * 로그·목록·감사 기록에는 앞 10자만 남긴다.
 */
export async function createEndpoint(actor: string, input: { url: string; events: unknown }): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
  const url = checkUrl(String(input.url ?? ""));
  const events = checkEvents(input.events);
  const secret = `whsec_${randomBytes(32).toString("hex")}`;
  const endpoint = await db.$transaction(async (tx) => {
    const e = await tx.webhookEndpoint.create({ data: { url, secret, events } });
    await audit(actor, "webhook.create", `webhook:${e.id}`, { url, events, secret_prefix: secretPrefix(secret) }, tx);
    return e;
  });
  return { endpoint, secret };
}

export async function updateEndpoint(actor: string, id: string, input: { active?: boolean; events?: unknown }): Promise<WebhookEndpoint> {
  const data: Prisma.WebhookEndpointUpdateInput = {};
  if (input.active !== undefined) data.active = !!input.active;
  if (input.events !== undefined) data.events = checkEvents(input.events);
  return db.$transaction(async (tx) => {
    const cur = await tx.webhookEndpoint.findUnique({ where: { id } });
    if (!cur) throw new HttpError(404, "NOT_FOUND", "웹훅 주소를 찾지 못했어요.");
    const e = await tx.webhookEndpoint.update({ where: { id }, data });
    await audit(actor, "webhook.update", `webhook:${id}`, { active: e.active, events: e.events }, tx);
    return e;
  });
}

export async function deleteEndpoint(actor: string, id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const cur = await tx.webhookEndpoint.findUnique({ where: { id } });
    if (!cur) throw new HttpError(404, "NOT_FOUND", "웹훅 주소를 찾지 못했어요.");
    await tx.webhookEndpoint.delete({ where: { id } });
    await audit(actor, "webhook.delete", `webhook:${id}`, { url: cur.url }, tx);
  });
}

/** "시험 보내기": 이 주소에만 ping 이벤트를 쌓고 바로 한 번 보낸다. */
export async function sendTest(actor: string, id: string, fetchImpl: typeof fetch = fetch): Promise<{ status: string; last_status: number | null }> {
  const e = await db.webhookEndpoint.findUnique({ where: { id } });
  if (!e) throw new HttpError(404, "NOT_FOUND", "웹훅 주소를 찾지 못했어요.");
  const now = new Date();
  await db.$transaction(async (tx) => {
    await emitEvent(tx, "ping", { message: "스터디온에듀 웹훅 시험 보내기예요." }, now, id);
    await audit(actor, "webhook.test", `webhook:${id}`, undefined, tx);
  });
  const d = await db.webhookDelivery.findFirstOrThrow({ where: { endpoint_id: id, type: "ping" }, orderBy: { created_at: "desc" } });
  const r = await post(e, d, fetchImpl, now);
  await finish(d, r, now);
  const after = await db.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
  return { status: after.status, last_status: after.last_status };
}

export async function recentDeliveries(take = 30) {
  const rows = await db.webhookDelivery.findMany({ orderBy: { created_at: "desc" }, take, include: { endpoint: { select: { url: true } } } });
  return rows.map((d) => ({
    id: d.id,
    type: d.type,
    url: d.endpoint.url,
    status: d.status,
    attempts: d.attempts,
    last_status: d.last_status,
    next_attempt_at: d.next_attempt_at.toISOString(),
    created_at: d.created_at.toISOString(),
  }));
}
