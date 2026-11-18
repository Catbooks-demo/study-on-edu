import { createHmac, timingSafeEqual } from "node:crypto";
import type { QueueSetting, QueueTicket } from "@prisma/client";
import { ADMIT_TTL_SEC, STALE_SEC, admitCount, etaSeconds } from "@/rules/queue";
import { audit } from "./audit";
import { db } from "./db";
import { getEnv } from "./env";
import { HttpError, readCookie } from "./http";
import { ENTRY_OPENS_BEFORE_MS } from "./live";
import { incQueueAdmitted } from "./metrics";

/**
 * 가상 대기실. 대상(target)마다 초당 한도만큼 차례로 들여보낸다.
 * - site: 수강생 화면 전체 (사이트 레이아웃이 문)
 * - checkout:<캠페인>: 결제 캠페인 (주문 만들기가 문, 대상 강의는 course_codes, 비면 모든 주문)
 * - live:<라이브 id>: 라이브 입장 (시작 10분 전부터 끝날 때까지 자동으로 켜짐)
 * 설정 행이 없으면 꺼진 것이다 (사이트·결제 캠페인은 기본 꺼짐).
 */
export type Target = "site" | `checkout:${string}` | `live:${string}`;

export const TARGET_RE = /^(site|checkout:[a-z0-9_-]{1,40}|live:[A-Za-z0-9_-]{1,40})$/;
export const isTarget = (v: unknown): v is Target => typeof v === "string" && TARGET_RE.test(v);

/** 기본 한도 (명/초): 사이트 50, 결제 캠페인 10, 라이브 20. */
export function defaultRate(target: string): number {
  if (target.startsWith("checkout:")) return 10;
  if (target.startsWith("live:")) return 20;
  return 50;
}

export const QUEUE_TEXT = "지금 접속이 많아 순서대로 들어가고 있어요. 이 화면을 닫지 말아 주세요.";

const cookieSafe = (target: string) => target.replace(/[^A-Za-z0-9_-]/g, "_");
/** 입장 허용 쿠키 이름 (`so_q_<대상>`, 쿠키 이름에 쓸 수 없는 `:`는 `_`로). */
export const admitCookieName = (target: string) => `so_q_${cookieSafe(target)}`;
/** 결제 캠페인 가격 유지 쿠키 (처음 받은 순번표). */
export const holdCookieName = (target: string) => `so_qh_${cookieSafe(target)}`;

// ── 설정 ──
const SETTING_CACHE_MS = 2_000;
const g = globalThis as unknown as { __studyonQueue?: Map<string, { at: number; value: QueueSetting | null }> };
const cache = () => (g.__studyonQueue ??= new Map());

export function resetQueueCache(): void {
  cache().clear();
}

/** 대상 설정 (메모리 2초 캐시). 없으면 null = 꺼짐. */
export async function getSetting(target: string): Promise<QueueSetting | null> {
  const c = cache().get(target);
  if (c && Date.now() - c.at < SETTING_CACHE_MS) return c.value;
  const value = await db.queueSetting.findUnique({ where: { target } });
  cache().set(target, { at: Date.now(), value });
  return value;
}

export type SettingInput = { enabled: boolean; rate_per_sec: number; course_codes?: string[] };

/** 켜기·끄기·한도 바꾸기 (감사 기록). actor: `staff:<id>`·`api:<키 이름>`·`system`. */
export async function updateSetting(actor: string, target: string, input: SettingInput, now: Date = new Date()): Promise<QueueSetting> {
  if (!isTarget(target)) throw new HttpError(400, "BAD_TARGET", "대상은 site, checkout:<이름>, live:<라이브 id> 중 하나예요.");
  const rate = Number(input.rate_per_sec);
  if (!Number.isInteger(rate) || rate < 1 || rate > 10_000) throw new HttpError(400, "BAD_RATE", "초당 한도는 1 이상의 정수예요.");
  const codes = input.course_codes?.map((c) => c.trim()).filter(Boolean).slice(0, 200);
  const data = { enabled: !!input.enabled, rate_per_sec: rate, ...(codes ? { course_codes: codes } : {}), updated_at: now };
  const row = await db.$transaction(async (tx) => {
    const r = await tx.queueSetting.upsert({
      where: { target },
      create: { target, ...data, course_codes: codes ?? [], admit_ttl_sec: ADMIT_TTL_SEC },
      update: data,
    });
    await audit(actor, "queue.update", `queue:${target}`, { enabled: r.enabled, rate_per_sec: r.rate_per_sec, course_codes: r.course_codes }, tx);
    return r;
  });
  cache().delete(target);
  return row;
}

// ── 입장 토큰 (HMAC-SHA256, SESSION_SECRET) ──
const secret = () => getEnv().SESSION_SECRET || "studyon-dev-only-secret";
const mac = (ticketId: string, target: string, expMs: number) =>
  createHmac("sha256", secret()).update(`${ticketId}|${target}|${expMs}`).digest("base64url");

export function signAdmit(ticketId: string, target: string, exp: Date): string {
  const ms = exp.getTime();
  return `${ticketId}.${ms}.${mac(ticketId, target, ms)}`;
}

/** 서명이 맞고 기한 안이면 {ticket_id, exp}, 아니면 null. */
export function verifyAdmit(token: string, target: string, now: Date): { ticket_id: string; exp: Date } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [ticketId, msRaw, sig] = parts;
  const ms = Number(msRaw);
  if (!ticketId || !Number.isSafeInteger(ms)) return null;
  const want = Buffer.from(mac(ticketId, target, ms));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (ms <= now.getTime()) return null;
  return { ticket_id: ticketId, exp: new Date(ms) };
}

// ── 줄 서기·들여보내기 ──

/** 들여보내기 (대상마다 한 번에 하나: advisory lock). 60초 동안 새로고침 없는 대기표는 먼저 만료한다. 들여보낸 수. */
export async function advance(target: string, now: Date): Promise<number> {
  const n = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`queue:${target}`}))`;
    const s = await tx.queueSetting.findUnique({ where: { target } });
    if (!s || !s.enabled) return 0;
    await tx.queueTicket.updateMany({
      where: { target, status: "waiting", last_seen_at: { lt: new Date(now.getTime() - STALE_SEC * 1000) } },
      data: { status: "expired" },
    });
    const waiting = await tx.queueTicket.count({ where: { target, status: "waiting" } });
    if (!waiting) return 0;
    const last = s.last_admit_at?.getTime() ?? now.getTime() - 1000;
    const a = admitCount(last, now.getTime(), s.rate_per_sec, waiting);
    if (a.n <= 0) return 0;
    const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM queue_tickets WHERE target = ${target} AND status = 'waiting'
      ORDER BY seq LIMIT ${a.n} FOR UPDATE SKIP LOCKED`;
    await tx.queueTicket.updateMany({
      where: { id: { in: ids.map((r) => r.id) } },
      data: { status: "admitted", admitted_at: now, expires_at: new Date(now.getTime() + s.admit_ttl_sec * 1000) },
    });
    await tx.queueSetting.update({ where: { target }, data: { last_admit_at: new Date(a.next_last_admit_at_ms) } });
    return ids.length;
  });
  incQueueAdmitted(target, n);
  return n;
}

/** 줄 서기: 순번(next_seq)을 원자적으로 늘려 대기표를 만들고, 한도 안이면 바로 입장시킨다. */
export async function join(target: string, now: Date): Promise<QueueTicket> {
  if (!isTarget(target)) throw new HttpError(400, "BAD_TARGET", "대기열 대상이 올바르지 않아요.");
  const t = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ seq: number }[]>`
      UPDATE queue_settings SET next_seq = next_seq + 1
      WHERE target = ${target} AND enabled = true
      RETURNING next_seq - 1 AS seq`;
    if (!rows.length) throw new HttpError(409, "QUEUE_OFF", "지금은 대기열 없이 들어갈 수 있어요.");
    return tx.queueTicket.create({ data: { target, seq: Number(rows[0].seq), issued_at: now, last_seen_at: now, created_at: now } });
  });
  await advance(target, now);
  return db.queueTicket.findUniqueOrThrow({ where: { id: t.id } });
}

export type PollResult = {
  ticket_id: string;
  target: string;
  status: "waiting" | "admitted" | "expired";
  ahead: number;
  eta_sec: number;
  admit_token?: string;
  expires_at?: string;
};

/** 내 차례 확인 (대기 화면이 3초마다). 새로고침 시각을 남기고 들여보내기를 한 번 돈다. */
export async function poll(ticketId: string, now: Date): Promise<PollResult> {
  let t = await db.queueTicket.findUnique({ where: { id: ticketId } });
  if (!t) throw new HttpError(404, "NOT_FOUND", "순번표를 찾지 못했어요. 처음부터 다시 줄을 서 주세요.");
  if (t.status === "waiting" && t.last_seen_at.getTime() < now.getTime() - STALE_SEC * 1000) {
    await db.queueTicket.updateMany({ where: { id: t.id, status: "waiting" }, data: { status: "expired" } });
    t = await db.queueTicket.findUniqueOrThrow({ where: { id: t.id } });
  }
  if (t.status === "waiting") {
    await db.queueTicket.updateMany({ where: { id: t.id, status: "waiting" }, data: { last_seen_at: now } });
    await advance(t.target, now);
    t = await db.queueTicket.findUniqueOrThrow({ where: { id: t.id } });
  }
  return view(t, now);
}

async function view(t: QueueTicket, now: Date): Promise<PollResult> {
  const base = { ticket_id: t.id, target: t.target };
  if (t.status === "admitted" && t.expires_at && t.expires_at > now) {
    return { ...base, status: "admitted", ahead: 0, eta_sec: 0, admit_token: signAdmit(t.id, t.target, t.expires_at), expires_at: t.expires_at.toISOString() };
  }
  if (t.status !== "waiting") return { ...base, status: "expired", ahead: 0, eta_sec: 0 };
  const ahead = await db.queueTicket.count({ where: { target: t.target, status: "waiting", seq: { lt: t.seq } } });
  const s = await getSetting(t.target);
  return { ...base, status: "waiting", ahead, eta_sec: etaSeconds(ahead + 1, s?.rate_per_sec ?? defaultRate(t.target)) };
}

/** join 결과를 대기 화면용 모양으로. */
export const ticketView = (t: QueueTicket, now: Date) => view(t, now);

// ── 문 ──
export type CookieSpec = { name: string; value: string; maxAge: number };
export type GateResult = { pass: true; ticket_id?: string; cookies?: CookieSpec[] } | { pass: false; ticket_id: string };

/** 입장(대상) 쿠키와, 결제 캠페인이면 가격 유지 쿠키(처음 받은 표만). */
export function admitCookies(req: Request | null, t: { id: string; target: string; issued_at: Date; expires_at: Date | null }, now: Date): CookieSpec[] {
  if (!t.expires_at) return [];
  const out: CookieSpec[] = [
    { name: admitCookieName(t.target), value: signAdmit(t.id, t.target, t.expires_at), maxAge: Math.max(1, Math.round((t.expires_at.getTime() - now.getTime()) / 1000)) },
  ];
  if (t.target.startsWith("checkout:")) {
    const hold = req ? readCookie(req, holdCookieName(t.target)) : undefined;
    if (!hold || !verifyAdmit(hold, `hold:${t.target}`, now)) {
      const exp = new Date(now.getTime() + 2 * 3600_000);
      out.push({ name: holdCookieName(t.target), value: signAdmit(t.id, `hold:${t.target}`, exp), maxAge: 2 * 3600 });
    }
  }
  return out;
}

/**
 * 문: 대기열이 꺼져 있거나 서명이 맞는 입장 쿠키가 기한 안이면 통과.
 * 그 밖에는 줄을 세워 바로 입장되면 쿠키를 붙여 통과, 아니면 대기표를 준다.
 */
export async function gate(req: Request, target: string, now: Date): Promise<GateResult> {
  const s = await getSetting(target);
  if (!s?.enabled) return { pass: true };
  const tok = readCookie(req, admitCookieName(target));
  if (tok && verifyAdmit(tok, target, now)) return { pass: true };
  let t: QueueTicket;
  try {
    t = await join(target, now);
  } catch (e) {
    if (e instanceof HttpError && e.code === "QUEUE_OFF") return { pass: true };
    throw e;
  }
  if (t.status === "admitted") return { pass: true, ticket_id: t.id, cookies: admitCookies(req, t, now) };
  return { pass: false, ticket_id: t.id };
}

/** 대기표를 받은 요청에 돌려줄 409 (클라이언트는 /waiting?ticket=…으로 간다). */
export function queueWaitResponse(ticketId: string, target: string): Response {
  return Response.json(
    { error: { code: "QUEUE_WAIT", message: "지금 접속이 많아 순서대로 들어가고 있어요. 잠시만 기다려 주세요.", ticket_id: ticketId, target } },
    { status: 409 },
  );
}

/** 결제 캠페인 중 이 강의들에 걸리는 대상 (course_codes가 비면 모든 주문). */
export async function checkoutTargetsFor(courseCodes: string[]): Promise<string[]> {
  const rows = await db.queueSetting.findMany({ where: { enabled: true, target: { startsWith: "checkout:" } }, orderBy: { target: "asc" } });
  return rows.filter((r) => !r.course_codes.length || r.course_codes.some((c) => courseCodes.includes(c))).map((r) => r.target);
}

/** 장바구니에 든 강의 코드 (패키지는 안의 강의까지). */
export async function cartCourseCodes(userId: string): Promise<string[]> {
  const items = await db.cartItem.findMany({
    where: { user_id: userId },
    include: { course: { select: { code: true } }, bundle: { include: { courses: { include: { course: { select: { code: true } } } } } } },
  });
  return [...new Set(items.flatMap((i) => [i.course?.code, ...(i.bundle?.courses.map((bc) => bc.course.code) ?? [])].filter((c): c is string => !!c)))];
}

/** 가격 유지 쿠키가 가리키는 순번표 발급 시각. */
export async function heldIssuedAt(req: Request, target: string, now: Date): Promise<Date | null> {
  const tok = readCookie(req, holdCookieName(target));
  const v = tok ? verifyAdmit(tok, `hold:${target}`, now) : null;
  if (!v) return null;
  const t = await db.queueTicket.findUnique({ where: { id: v.ticket_id } });
  return t && t.target === target ? t.issued_at : null;
}

// ── 주기 작업·통계 ──

/**
 * 대기열 정리 (주기 작업): 라이브 대기열 자동 켜기(시작 10분 전 ~ 끝)·끄기, 60초 미접속 대기표 만료,
 * 켜진 대상 들여보내기, 하루 지난 끝난 표 지우기. 바뀐 수를 돌려준다.
 * 직원·API가 창 안에서 라이브 대기열을 직접 끄면(그 뒤로 바뀐 기록) 다시 켜지 않는다.
 */
export async function queueHousekeeping(now: Date): Promise<number> {
  let changed = 0;
  const lives = await db.liveSession.findMany({
    where: { status: { not: "cancelled" }, starts_at: { lte: new Date(now.getTime() + ENTRY_OPENS_BEFORE_MS) }, ends_at: { gt: now } },
    select: { id: true, starts_at: true },
  });
  for (const l of lives) {
    const target = `live:${l.id}`;
    const windowStart = new Date(l.starts_at.getTime() - ENTRY_OPENS_BEFORE_MS);
    const s = await db.queueSetting.findUnique({ where: { target } });
    if (s?.enabled || (s && s.updated_at >= windowStart)) continue;
    await updateSetting("system", target, { enabled: true, rate_per_sec: s?.rate_per_sec ?? defaultRate(target) }, now);
    changed++;
  }
  const liveOn = await db.queueSetting.findMany({ where: { enabled: true, target: { startsWith: "live:" } } });
  for (const s of liveOn) {
    const live = await db.liveSession.findUnique({ where: { id: s.target.slice(5) }, select: { ends_at: true, status: true } });
    if (!live || live.status === "cancelled" || live.ends_at <= now) {
      await updateSetting("system", s.target, { enabled: false, rate_per_sec: s.rate_per_sec }, now);
      changed++;
    }
  }
  const stale = await db.queueTicket.updateMany({
    where: { status: "waiting", last_seen_at: { lt: new Date(now.getTime() - STALE_SEC * 1000) } },
    data: { status: "expired" },
  });
  changed += stale.count;
  const busy = await db.queueTicket.groupBy({ by: ["target"], where: { status: "waiting" } });
  for (const b of busy) changed += await advance(b.target, now);
  await db.queueTicket.deleteMany({ where: { status: { not: "waiting" }, created_at: { lt: new Date(now.getTime() - 86_400_000) } } });
  return changed;
}

/** 직원 화면·API용 통계. */
export async function queueStats(target: string, now: Date): Promise<{ waiting: number; avg_wait_sec: number; admitted_last_min: number }> {
  const [waiting, lastMin, recent] = await Promise.all([
    db.queueTicket.count({ where: { target, status: "waiting" } }),
    db.queueTicket.count({ where: { target, admitted_at: { gte: new Date(now.getTime() - 60_000) } } }),
    db.queueTicket.findMany({
      where: { target, admitted_at: { gte: new Date(now.getTime() - 10 * 60_000) } },
      select: { issued_at: true, admitted_at: true },
      take: 5000,
    }),
  ]);
  const avg = recent.length ? recent.reduce((a, r) => a + (r.admitted_at!.getTime() - r.issued_at.getTime()), 0) / recent.length / 1000 : 0;
  return { waiting, avg_wait_sec: Math.round(avg * 10) / 10, admitted_last_min: lastMin };
}

/** 모든 설정 + 통계 (직원 화면·v1 API). */
export async function listQueues(now: Date) {
  const rows = await db.queueSetting.findMany({ orderBy: { target: "asc" } });
  return Promise.all(
    rows.map(async (s) => ({
      target: s.target,
      enabled: s.enabled,
      rate_per_sec: s.rate_per_sec,
      admit_ttl_sec: s.admit_ttl_sec,
      course_codes: s.course_codes,
      updated_at: s.updated_at.toISOString(),
      ...(await queueStats(s.target, now)),
    })),
  );
}
