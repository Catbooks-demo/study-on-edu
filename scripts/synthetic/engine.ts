/**
 * 가상 이용자를 스터디온에듀 서버 함수로 넣는 부분 (DB를 쓴다).
 *
 * 결제·수강권·진도·환불·구독·질문·후기·문의·라이브는 서버 함수(addToCart·createOrder·mockPay, subscribe·
 * payFirstInvoiceMock·cancelAtPeriodEnd·pause·changeCard, startPlayback·heartbeat, issueCertificate,
 * requestRefund·approveRefund, askQuestion·answerQuestion, writeReview, createInquiry·answerInquiry,
 * reserveSeat·enterLive·postChat, runJobsOnce)를 그 시각(now)으로 그대로 부른다. 그래서 금액·환불 계산·
 * 진도·상태가 실제 이용과 같은 규칙으로 맞는다. 되채우기는 지난 시각으로 부르고, 서버가 "지금"으로 찍는 칸
 * (created_at 등)을 그 시각으로 옮겨 적는다(stampSince). 매일 모드는 지금 시각으로 부르고 옮겨 적지 않는다.
 *
 * 시청: 이 프로세스에서만 하트비트 주기를 1800초로 둔다(HEARTBEAT_SEC_FOR_SYNTH). 서버의 acceptSegment는
 * "지난 하트비트 뒤 흐른 시간 × 배속"만큼 받으므로, 강 하나를 이어 본 조각마다 startPlayback 한 번 +
 * heartbeat 한 번으로 실제 규칙 그대로 진도가 쌓인다. 그래서 watch_events는 30초마다가 아니라
 * (세션, 강)마다 한 줄이다.
 */
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { effectivePrice } from "@/rules/pricing";
import { addDays, kstDate, kstDateTime } from "@/rules/time";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { addToCart } from "@/server/cart";
import { issueCertificate } from "@/server/certificates";
import { db } from "@/server/db";
import { HttpError } from "@/server/http";
import { answerInquiry, createInquiry } from "@/server/inquiries";
import { JOBS, runJobsOnce, SYNTH_BACKFILL_LOCK } from "@/server/jobs";
import { enterLive, postChat, reserveSeat } from "@/server/live";
import { recordMessage } from "@/server/messages";
import { createOrder } from "@/server/orders";
import { mockPay } from "@/server/payments";
import { heartbeat, startPlayback } from "@/server/player";
import { answerQuestion, askQuestion } from "@/server/qa";
import { approveRefund, rejectRefund, requestRefund, requestSubscriptionRefund } from "@/server/refunds";
import { recalcRating, writeReview } from "@/server/reviews";
import { cancelAtPeriodEnd, changeCard, pause, payFirstInvoiceMock, subscribe } from "@/server/subscriptions";
import {
  ANSWER_TEXTS,
  catalog,
  type Cat,
  type Chain,
  chainRatio,
  DEVICE_UA,
  deviceKey,
  discountShareOn,
  FAIL_CARD,
  FAULT_INQUIRY,
  inFault,
  INQUIRY_KINDS,
  type Intent,
  LIVE_CHATS,
  LIVE_RATES,
  type Model,
  nextSession,
  nextSessionAt,
  pastLives,
  PLANTED,
  QUESTION_TEXTS,
  RATES,
  RATING_SHARE,
  REFUND_REASONS,
  SALE_COUPONS,
  SUB_INQUIRY,
  SUBS,
  SYNTH_COUPON_PREFIX,
  SYNTH_DEVICE_PREFIX,
  SYNTH_DOMAIN,
  SYNTH_STAFF_EMAIL,
  CATEGORY_CODES,
} from "./model";
import { chainsFor, coursesOf } from "./preview";
import { REVIEW_BODIES } from "../../prisma/seed-data/reviews";
import { Rng } from "./rng";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const LIKE = `%@${SYNTH_DOMAIN}`;

/** 이 프로세스에서만 쓰는 하트비트 주기(초). 강 한 조각(최대 25분 ÷ 0.75배)을 하트비트 한 번으로 받게. */
export const HEARTBEAT_SEC_FOR_SYNTH = 1800;

// ── 사건 ──
export type Ev =
  | { kind: "watch"; t: number; chain: Chain; sessionT: number; from: number }
  | { kind: "rewatch"; t: number; member: number; course: string; lec: number; device: number }
  | { kind: "refund"; t: number; member: number; target: "item" | "sub"; id: string; reason: number; decideH: number; reject: boolean; product: string }
  | { kind: "decide_refund"; t: number; id: string; reject: boolean }
  | { kind: "inquiry"; t: number; member: number; category: string; title: string; body: string; answer: string; answerH: number; tag: string }
  | { kind: "answer_inquiry"; t: number; id: string; answer: string }
  | { kind: "question"; t: number; member: number; course: string; lec: number }
  | { kind: "answer_question"; t: number; id: string; by: "instructor" | "staff"; instructorId: string; text: string }
  | { kind: "review"; t: number; member: number; course: string }
  | { kind: "sub_tick"; t: number; member: number; subId: string; plan: "monthly" | "yearly"; n: number }
  | { kind: "sub_card"; t: number; member: number; subId: string; card: string }
  | { kind: "jobs"; t: number }
  | { kind: "live_plan"; t: number; from: number; to: number }
  | { kind: "live_reserve"; t: number; member: number; sessionId: string; enterAt: number | null; chatAt: number | null }
  | { kind: "live_enter"; t: number; member: number; sessionId: string; chatAt: number | null }
  | { kind: "live_chat"; t: number; member: number; sessionId: string; text: number }
  | { kind: "cert_spike"; t: number }
  | { kind: "fault_surge"; t: number }
  | { kind: "compensate"; t: number };

/** 시각 순 줄 (같은 시각이면 넣은 순서). */
export class EventQueue {
  private heap: { ev: Ev; seq: number }[] = [];
  private seq = 0;

  constructor(items: Ev[] = []) {
    for (const ev of items) this.push(ev);
  }
  get size(): number {
    return this.heap.length;
  }
  push(ev: Ev): void {
    const h = this.heap;
    h.push({ ev, seq: this.seq++ });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  peek(): Ev | undefined {
    return this.heap[0]?.ev;
  }
  pop(): Ev | undefined {
    const h = this.heap;
    if (!h.length) return undefined;
    const top = h[0].ev;
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(l, m)) m = l;
        if (r < h.length && this.less(r, m)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
  toArray(): Ev[] {
    return [...this.heap].sort((a, b) => a.ev.t - b.ev.t || a.seq - b.seq).map((x) => x.ev);
  }
  private less(a: number, b: number): boolean {
    const x = this.heap[a];
    const y = this.heap[b];
    return x.ev.t < y.ev.t || (x.ev.t === y.ev.t && x.seq < y.seq);
  }
}

// ── 하루 집계 ──
export interface DayStats {
  planned: number;
  inserted: number;
  lost: number; // 후보를 모두 살 수 없어 못 넣음
  /** 서버가 업무 오류(4xx)로 받지 않아 건너뛴 결제 계획. 예전 상태 파일에는 없을 수 있다. */
  skipped?: number;
  missed: number; // 매일 모드가 꺼져 있어 놓침
  byKind: Record<string, number>;
  byCat: Record<string, number>;
  followups: Record<string, number>;
}
export const emptyStats = (): DayStats => ({ planned: 0, inserted: 0, lost: 0, skipped: 0, missed: 0, byKind: {}, byCat: {}, followups: {} });

/** 매일 모드로 넘기는 덧붙임 상태 (장애·보상 쿠폰). */
export interface Extra {
  faultUsers: number[]; // 진도 저장이 끊긴 회원
  faultSessions: number;
  faultInquirers: number[];
  sorry: number[]; // 보상 쿠폰을 받은 회원
  sorryUsed: number[];
  spikeRewatch: number;
  /** 업무 오류(4xx)로 건너뛴 일: "종류:오류 코드" → 수. 예전 상태 파일에는 없을 수 있다. */
  skips?: Record<string, number>;
}
export const emptyExtra = (): Extra => ({ faultUsers: [], faultSessions: 0, faultInquirers: [], sorry: [], sorryUsed: [], spikeRewatch: 0, skips: {} });

interface CourseRow {
  id: string;
  code: string;
  cat: Cat;
  title: string;
  instructorId: string;
  price: number;
  sale_price: number | null;
  sale_ends_at: Date | null;
  inSubscription: boolean;
  lectures: { id: string; duration: number }[];
}

export interface Ctx {
  model: Model;
  staffId: string;
  userIds: Map<number, string>;
  courses: Map<string, CourseRow>;
  stats: Map<string, DayStats>;
  queue: EventQueue;
  extra: Extra;
  /** 되채우기면 지난 시각을 옮겨 적을 기준(진짜 시계). 매일 모드면 null. */
  since: Date | null;
  /** 이보다 늦은 시청 조각은 넣지 않는다 (되채우기: 되채운 시각, 매일 모드: 지금). */
  limit: () => number;
  log: (msg: string) => void;
}

export function dayStats(ctx: Ctx, date: string): DayStats {
  let s = ctx.stats.get(date);
  if (!s) ctx.stats.set(date, (s = emptyStats()));
  return s;
}
export const bump = (ctx: Ctx, t: number, what: string, n = 1) => {
  const s = dayStats(ctx, kstDate(new Date(t)));
  s.followups[what] = (s.followups[what] ?? 0) + n;
};

/** 끝난 것으로 치는 오류: 상태가 이미 바뀌었거나(환불·해지·만료) 할 일이 없을 때. */
export function skippable(e: unknown): e is HttpError {
  return e instanceof HttpError && e.status >= 400 && e.status < 500;
}

/** 같은 "종류:코드"는 로그에 이만큼만 남기고 그 뒤로는 세기만 한다 (수천 줄이 되지 않게). */
const SKIP_LOG_MAX = 5;

/** 업무 오류로 건너뛴 일 하나: 그날 followups(skipped_<종류>)와 extra.skips(종류:코드)에 세고 로그를 남긴다. */
export function noteSkip(ctx: Ctx, t: number, what: string, e: HttpError, detail: string): void {
  bump(ctx, t, `skipped_${what}`);
  const skips = (ctx.extra.skips ??= {});
  const k = `${what}:${e.code}`;
  const n = (skips[k] = (skips[k] ?? 0) + 1);
  if (n <= SKIP_LOG_MAX) {
    const more = n === SKIP_LOG_MAX ? ` (${k}는 이제 로그 없이 세기만 해요)` : "";
    ctx.log(`건너뜀 ${what} ${detail} @${new Date(t).toISOString()}: ${e.status} ${e.code} ${e.message}${more}`);
  }
}

// ── 시각 ──
/** 되채우기는 사건 시각, 매일 모드는 지금. */
const clock = (ctx: Ctx, t: number) => (ctx.since ? new Date(t) : new Date());

/** 타임스탬프 열(timestamp without time zone, UTC 값)에 넣을 문자열. */
const ts = (d: Date) => d.toISOString().replace("Z", "");

const TABLES_ALL: [string, string[]][] = [
  ["devices", ["created_at"]],
  ["orders", ["created_at"]],
  ["order_items", ["created_at"]],
  ["payments", ["created_at", "approved_at"]],
  ["coupons", []],
  ["subscriptions", ["created_at"]],
  ["subscription_invoices", ["created_at"]],
  ["enrollments", ["created_at"]],
  ["lecture_progress", ["created_at"]],
  ["questions", ["created_at"]],
  ["answers", ["created_at"]],
  ["reviews", ["created_at"]],
  ["courses", []],
  ["inquiries", ["created_at"]],
  ["refunds", ["created_at"]],
  ["live_sessions", []],
];
const CREATED_ONLY = ["messages", "audit_logs", "certificates", "live_seats", "coupon_redemptions"];
const TABLES_WATCH = new Set(["devices", "enrollments", "lecture_progress"]);

/**
 * `since` 이후(진짜 시계)에 서버가 "지금"으로 찍은 칸을 사건 시각으로 옮긴다. 되채우기 동안 이 DB에 쓰는 것은
 * 이 프로세스뿐이어야 한다(앱의 주기 작업을 멈추고 돌린다). job_runs의 지난 시각 실행 기록은 지운다.
 * 매일 모드(since=null)는 아무것도 하지 않는다.
 */
export async function stamp(ctx: Ctx, at: number, scope: "all" | "watch" = "all"): Promise<void> {
  if (!ctx.since) return;
  const s = ts(ctx.since);
  const t = ts(new Date(at));
  const C = (col: string) => `${col} = CASE WHEN ${col} >= CAST($1 AS timestamp(3)) THEN CAST($2 AS timestamp(3)) ELSE ${col} END`;
  const qs: string[] = [];
  for (const [table, cols] of TABLES_ALL) {
    if (scope === "watch" && !TABLES_WATCH.has(table)) continue;
    qs.push(`UPDATE ${table} SET ${[...cols.map(C), "updated_at = CAST($2 AS timestamp(3))"].join(", ")} WHERE updated_at >= CAST($1 AS timestamp(3))`);
  }
  if (scope === "all") {
    for (const table of CREATED_ONLY) qs.push(`UPDATE ${table} SET created_at = CAST($2 AS timestamp(3)) WHERE created_at >= CAST($1 AS timestamp(3))`);
  }
  await db.$transaction([
    ...qs.map((q) => db.$executeRawUnsafe(q, s, t)),
    ...(scope === "all" ? [db.$executeRawUnsafe(`DELETE FROM job_runs WHERE started_at >= CAST($1 AS timestamp(3))`, s)] : []),
  ]);
}

// ── 준비 ──
/** 아무도 모르는 비밀번호의 해시 하나 (가상 회원·직원은 로그인할 수 없다). */
export async function unusableHash(): Promise<string> {
  return hashPassword(randomBytes(24).toString("base64url"));
}

/** 가상 운영 담당 직원 (환불 승인·문의 답변·질문 답변 일부). 비활성이라 로그인할 수 없다. */
export async function ensureStaff(): Promise<string> {
  const found = await db.staff.findUnique({ where: { email: SYNTH_STAFF_EMAIL } });
  if (found) return found.id;
  const s = await db.staff.create({ data: { email: SYNTH_STAFF_EMAIL, name: "가상 운영 담당", role: "cs", active: false, password_hash: await unusableHash() } });
  return s.id;
}

/** 가상 쿠폰: 할인 쿠폰(기간 내내)과 11/3 보상 쿠폰. */
export async function ensureCoupons(windowStart: string): Promise<void> {
  const from = kstDateTime(addDays(windowStart, -30));
  const to = kstDateTime(addDays(windowStart, 800));
  for (const [code, pct] of SALE_COUPONS) {
    const data = { name: `가상 할인 ${pct}%`, kind: "percent", value: pct, target: "all", starts_at: from, ends_at: to, per_user_once: false, active: true };
    await db.coupon.upsert({ where: { code }, create: { code, ...data, created_at: from, updated_at: from }, update: {} });
  }
  const c = PLANTED.fault.compensation;
  const start = kstDateTime(c.date, c.hour);
  await db.coupon.upsert({
    where: { code: c.code },
    create: {
      code: c.code,
      name: "11/2 진도 저장 장애 보상 쿠폰",
      kind: "fixed",
      value: c.amount,
      target: "all",
      starts_at: start,
      ends_at: new Date(start.getTime() + c.days * DAY),
      per_user_once: true,
      active: true,
      created_at: start,
      updated_at: start,
    },
    update: {},
  });
}

export async function insertMembers(model: Model, log: (m: string) => void): Promise<void> {
  const hash = await unusableHash();
  const CHUNK = 1000;
  for (let i = 0; i < model.members.length; i += CHUNK) {
    const part = model.members.slice(i, i + CHUNK);
    await db.user.createMany({
      data: part.map((m) => ({
        email: m.email,
        password_hash: hash,
        name: m.name,
        phone: m.phone,
        birth_year: m.birthYear,
        interests: m.interests,
        marketing_opt_in: m.marketing,
        created_at: new Date(m.joinedAt),
        updated_at: new Date(m.joinedAt),
      })),
      skipDuplicates: true,
    });
    if ((i / CHUNK) % 10 === 0) log(`가상 회원 ${Math.min(i + CHUNK, model.members.length).toLocaleString()}/${model.members.length.toLocaleString()}`);
  }
}

/** 회원 번호 → user id (이메일 m00001@… 의 번호). */
export async function loadUserIds(): Promise<Map<number, string>> {
  const rows = await db.user.findMany({ where: { email: { endsWith: `@${SYNTH_DOMAIN}` } }, select: { id: true, email: true } });
  const out = new Map<number, string>();
  for (const r of rows) {
    const m = /^m(\d+)@/.exec(r.email);
    if (m) out.set(Number(m[1]) - 1, r.id);
  }
  return out;
}

/** 시드 강의를 DB에서 (강 id·길이). 시드 규칙으로 만든 목록과 길이가 다르면 멈춘다. */
export async function loadCourses(): Promise<Map<string, CourseRow>> {
  const rows = await db.course.findMany({
    where: { status: "published", code: { in: catalog().courses.map((c) => c.code) } },
    include: { category: true, lectures: { orderBy: { sort: "asc" }, select: { id: true, duration_sec: true } } },
  });
  const out = new Map<string, CourseRow>();
  for (const r of rows) {
    const info = catalog().byCode.get(r.code)!;
    const lectures = r.lectures.slice(0, info.durations.length).map((l) => ({ id: l.id, duration: l.duration_sec }));
    if (lectures.length !== info.durations.length || lectures.some((l, i) => l.duration !== info.durations[i])) {
      throw new Error(`강의 ${r.code}의 강 길이가 시드 규칙과 달라요. 시드(npm run db:seed)를 다시 돌린 뒤 해 주세요.`);
    }
    out.set(r.code, {
      id: r.id,
      code: r.code,
      cat: r.category.code as Cat,
      title: r.title,
      instructorId: r.instructor_id,
      price: r.price,
      sale_price: r.sale_price,
      sale_ends_at: r.sale_ends_at,
      inSubscription: r.in_subscription,
      lectures,
    });
  }
  if (out.size !== catalog().courses.length) throw new Error(`공개 강의가 ${out.size}개예요(시드 ${catalog().courses.length}개). 시드를 먼저 돌려 주세요.`);
  return out;
}

/** 기간 안 지난 라이브(시드 12개의 지난 회차)와 수능 해설 라이브를 만든다. 가상 직원 작업 기록이 표시다. */
export async function ensureLives(ctx: Ctx, windowStart: string, windowEnd: string): Promise<number> {
  const marked = await db.auditLog.findMany({ where: { actor: `staff:${ctx.staffId}`, action: "synth.live.create" }, select: { target: true } });
  const have = new Set(
    (await db.liveSession.findMany({ where: { id: { in: marked.map((m) => m.target.replace(/^live:/, "")) } }, select: { title: true } })).map((s) => s.title),
  );
  const instructors = new Map((await db.instructor.findMany({ select: { id: true, slug: true } })).map((i) => [i.slug, i.id]));
  const courseIdByTitle = new Map([...ctx.courses.values()].map((c) => [c.title, c.id]));
  const wanted = [
    ...pastLives(windowStart, windowEnd),
    { title: PLANTED.csatLive.title, description: PLANTED.csatLive.description, by: PLANTED.csatLive.by, course: null, date: PLANTED.csatLive.date, hour: PLANTED.csatLive.hour, minutes: PLANTED.csatLive.minutes },
  ];
  let made = 0;
  for (const l of wanted) {
    if (have.has(l.title)) continue;
    const starts = kstDateTime(l.date, l.hour);
    const created = new Date(starts.getTime() - 14 * DAY);
    const s = await db.liveSession.create({
      data: {
        title: l.title,
        description: l.description,
        instructor_id: instructors.get(l.by)!,
        course_id: l.course ? (courseIdByTitle.get(l.course) ?? null) : null,
        starts_at: starts,
        ends_at: new Date(starts.getTime() + l.minutes * MIN),
        capacity: l.title === PLANTED.csatLive.title ? PLANTED.csatLive.capacity : 300,
        created_at: created,
        updated_at: created,
      },
    });
    await db.auditLog.create({ data: { actor: `staff:${ctx.staffId}`, action: "synth.live.create", target: `live:${s.id}`, created_at: created } });
    made++;
  }
  return made;
}

// ── 결제 넣기 ──
const ALREADY = new Set(["ALREADY_ENROLLED", "NOT_FOR_SALE"]);

/** 할인 쿠폰을 쓸 확률: 그날 할인가 결제 목표에서 패키지(늘 할인)와 할인 중 강의 몫을 뺀 나머지를 쿠폰으로. */
export function couponProbability(ctx: Pick<Ctx, "courses">, at: Date): number {
  const list = [...ctx.courses.values()];
  const sale = list.filter((c) => effectivePrice(c, at).onSale).length / Math.max(1, list.length);
  const b = 8 / 80;
  const s = 1 - b;
  const D = discountShareOn(kstDate(at));
  if (sale >= 1) return 0;
  return Math.min(1, Math.max(0, (D - b - s * sale) / (s * (1 - sale))));
}

const sorryValid = (t: number) => {
  const c = PLANTED.fault.compensation;
  const start = kstDateTime(c.date, c.hour).getTime();
  return t >= start && t < start + c.days * DAY;
};

/**
 * 계획 하나를 결제로. 넣었으면 true.
 * 서버가 업무 오류(4xx: 이미 결제·취소된 주문, 쿠폰 조건 등)로 받지 않으면 그 계획만 건너뛰고(skipped) false.
 * 그 밖의 오류(DB·코드 오류)는 그대로 던져 실행을 멈춘다.
 */
export async function placeIntent(ctx: Ctx, intent: Intent): Promise<boolean> {
  try {
    return await placeIntentOnce(ctx, intent);
  } catch (e) {
    if (!skippable(e)) throw e;
    const st = dayStats(ctx, intent.day);
    st.skipped = (st.skipped ?? 0) + 1;
    noteSkip(ctx, intent.t, "intent", e, `${intent.key} (m${intent.member + 1}, ${intent.kind})`);
    if (ctx.since) await stamp(ctx, intent.t);
    return false;
  }
}

async function placeIntentOnce(ctx: Ctx, intent: Intent): Promise<boolean> {
  const st = dayStats(ctx, intent.day);
  const uid = ctx.userIds.get(intent.member);
  if (!uid) throw new Error(`가상 회원이 DB에 없어요: m${intent.member + 1}`);
  resetRateLimits();
  const now = clock(ctx, intent.t);
  const payAt = new Date(now.getTime() + Math.round(intent.fate.payDelayMin * MIN));
  let ok = false;
  if (intent.kind === "monthly" || intent.kind === "yearly") {
    try {
      const r = await subscribe(uid, intent.kind, { card_last4: intent.fate.card }, now);
      await stamp(ctx, now.getTime());
      await payFirstInvoiceMock(r.invoice.id, payAt);
      await stamp(ctx, payAt.getTime());
      afterSubscribe(ctx, intent, r.subscription.id, payAt.getTime(), r.subscription.current_period_end.getTime());
      ok = true;
    } catch (e) {
      if (!(e instanceof HttpError && e.code === "ALREADY_SUBSCRIBED")) throw e;
      bump(ctx, intent.t, "already_subscribed_to_single");
      ok = await placeOrder(ctx, { ...intent, kind: "single" }, uid, now, payAt);
    }
  } else ok = await placeOrder(ctx, intent, uid, now, payAt);
  if (!ok) {
    st.lost++;
    return false;
  }
  st.inserted++;
  st.byKind[intent.kind] = (st.byKind[intent.kind] ?? 0) + 1;
  st.byCat[intent.cat] = (st.byCat[intent.cat] ?? 0) + 1;
  return true;
}

async function placeOrder(ctx: Ctx, intent: Intent, uid: string, now: Date, payAt: Date): Promise<boolean> {
  await db.cartItem.deleteMany({ where: { user_id: uid } });
  let chosen: string | null = null;
  for (const code of intent.candidates) {
    try {
      await addToCart(uid, intent.kind === "bundle" ? { bundle_code: code } : { course_code: code }, now);
      chosen = code;
      break;
    } catch (e) {
      if (e instanceof HttpError && ALREADY.has(e.code)) continue;
      throw e;
    }
  }
  if (!chosen) return false;
  // 쿠폰: 보상 쿠폰을 받은 회원은 30% 확률로 그것을, 아니면 할인 중이 아닌 단과에 할인 쿠폰
  let coupon: string | null = null;
  const rng = new Rng(`${ctx.model.seed}:coupon:${intent.key}`);
  if (ctx.extra.sorry.includes(intent.member) && !ctx.extra.sorryUsed.includes(intent.member) && sorryValid(now.getTime()) && rng.chance(PLANTED.fault.compensation.useRate)) {
    coupon = PLANTED.fault.compensation.code;
  } else if (intent.kind === "single") {
    const c = ctx.courses.get(chosen)!;
    if (!effectivePrice(c, now).onSale && intent.fate.discountU < couponProbability(ctx, now)) coupon = SALE_COUPONS[intent.fate.coupon][0];
  }
  let order;
  try {
    order = await createOrder(uid, { coupon_code: coupon }, now);
  } catch (e) {
    if (!(coupon && e instanceof HttpError && e.code.startsWith("COUPON"))) throw e;
    coupon = null;
    order = await createOrder(uid, {}, now);
  }
  if (coupon === PLANTED.fault.compensation.code) ctx.extra.sorryUsed.push(intent.member);
  await stamp(ctx, now.getTime());
  await mockPay(order.code, payAt);
  await stamp(ctx, payAt.getTime());
  const items = await db.orderItem.findMany({ where: { order_id: order.id }, select: { id: true } });
  afterOrder(ctx, intent, chosen, items[0].id, payAt.getTime());
  return true;
}

/** 수강권마다 시청 흐름·질문을 줄에 넣는다. */
function scheduleWatching(ctx: Ctx, intent: Intent, courses: string[], t0: number): void {
  for (const { chain, firstT } of chainsFor(ctx.model, intent, courses, t0)) {
    ctx.queue.push({ kind: "watch", t: firstT, chain, sessionT: firstT, from: 0 });
    const c = catalog().byCode.get(chain.course)!;
    const rng = new Rng(`${ctx.model.seed}:question:${chain.key}`);
    const rate = c.cat === "DEV" || c.cat === "DATA" ? RATES.questionDevData : RATES.question;
    if (chain.reach > 0 && rng.chance(rate)) {
      ctx.queue.push({ kind: "question", t: firstT + Math.round(rng.uniform(0.5, 10 * 24) * HOUR), member: intent.member, course: chain.course, lec: rng.int(0, chain.reach - 1) });
    }
  }
}

function scheduleInquiry(ctx: Ctx, intent: Intent, t0: number): void {
  const f = intent.fate.inquiry;
  if (!f) return;
  const sub = intent.kind === "monthly" || intent.kind === "yearly";
  const k = sub && f.kind < 50 ? SUB_INQUIRY : INQUIRY_KINDS[pickByPercent(f.kind, INQUIRY_KINDS.map((x) => x.w))];
  ctx.queue.push({ kind: "inquiry", t: t0 + Math.round(f.delayH * HOUR), member: intent.member, category: k.category, title: k.title, body: k.body, answer: k.answer, answerH: f.answerH, tag: "order" });
}
const pickByPercent = (u: number, w: number[]) => {
  const total = w.reduce((a, b) => a + b, 0);
  let x = (u / 100) * total;
  for (let i = 0; i < w.length; i++) if ((x -= w[i]) < 0) return i;
  return w.length - 1;
};

function afterOrder(ctx: Ctx, intent: Intent, chosen: string, itemId: string, t0: number): void {
  scheduleWatching(ctx, intent, coursesOf(intent, chosen), t0);
  scheduleInquiry(ctx, intent, t0);
  const r = intent.fate.refund;
  if (r) ctx.queue.push({ kind: "refund", t: t0 + Math.round(r.delayH * HOUR), member: intent.member, target: "item", id: itemId, reason: r.reason, decideH: r.decideH, reject: r.reject, product: intent.kind });
}

function afterSubscribe(ctx: Ctx, intent: Intent, subId: string, t0: number, periodEnd: number): void {
  scheduleWatching(ctx, intent, intent.candidates, t0);
  scheduleInquiry(ctx, intent, t0);
  const r = intent.fate.refund;
  if (r) ctx.queue.push({ kind: "refund", t: t0 + Math.round(r.delayH * HOUR), member: intent.member, target: "sub", id: subId, reason: r.reason, decideH: r.decideH, reject: r.reject, product: intent.kind });
  const plan = intent.kind as "monthly" | "yearly";
  const rng = new Rng(`${ctx.model.seed}:subtick:${subId}:0`);
  ctx.queue.push({ kind: "sub_tick", t: t0 + Math.round(rng.uniform(0.1, 0.9) * (periodEnd - t0)), member: intent.member, subId, plan, n: 0 });
}

// ── 시청 ──
async function watch(ctx: Ctx, ev: Extract<Ev, { kind: "watch" }>): Promise<void> {
  const { model } = ctx;
  const chain = ev.chain;
  const s = nextSession(model, chain, ev.sessionT);
  if (!s) return;
  const uid = ctx.userIds.get(chain.member)!;
  const course = ctx.courses.get(chain.course)!;
  const m = model.members[chain.member];
  const type = m.devices[s.device];
  const ua = DEVICE_UA[type][m.index % DEVICE_UA[type].length];
  const dev = deviceKey(m.index, s.device);
  const limit = ctx.limit();
  const before = chainRatio(chain);
  let endT = ev.sessionT;
  for (let i = ev.from; i < s.pieces.length; i++) {
    const p = s.pieces[i];
    const tp = ev.sessionT + p.at * 1000;
    const te = tp + Math.round(((p.to - p.from) / p.rate) * 1000);
    if (te > limit) {
      // 아직 끝나지 않은 조각: 끝날 시각에 이어서 (그 전 조각은 이미 넣었다)
      ctx.queue.push({ ...ev, t: te, from: i });
      return;
    }
    const lec = course.lectures[p.lec];
    resetRateLimits();
    try {
      await startPlayback(uid, { lecture_id: lec.id, device_id: dev }, new Date(tp), ua);
    } catch (e) {
      if (e instanceof HttpError && e.code === "NO_ACCESS") return noAccess(ctx, ev, tp);
      throw e;
    }
    await stamp(ctx, tp, "watch");
    if (inFault(te) && new Rng(`${model.seed}:fault:${chain.key}:${chain.seq}:${i}`).chance(PLANTED.fault.errorRate)) {
      // 심어 둔 장애: 진도 저장(하트비트)이 실패해 시청이 끊긴다. 이 조각은 저장되지 않는다.
      if (!ctx.extra.faultUsers.includes(chain.member)) ctx.extra.faultUsers.push(chain.member);
      ctx.extra.faultSessions++;
      bump(ctx, te, "fault_broken_session");
      const after: Chain = { ...chain, seq: chain.seq + 1, lec: p.lec, pos: p.from };
      const retry = te + Math.round(new Rng(`${model.seed}:fault-retry:${chain.key}`).uniform(1, 5) * HOUR);
      ctx.queue.push({ kind: "watch", t: retry, chain: after, sessionT: retry, from: 0 });
      return;
    }
    await heartbeat(uid, { lecture_id: lec.id, from_sec: p.from, to_sec: p.to, position_sec: p.to, rate: p.rate, device_id: dev }, new Date(te));
    await stamp(ctx, te, "watch");
    bump(ctx, te, "watch_rows");
    endT = te;
  }
  bump(ctx, ev.sessionT, "sessions");
  await afterWatch(ctx, chain, s.after, before, endT, !s.last);
}

/** 세션 뒤: 수료증(진도 80%)·후기(40%·완강)·다음 세션. */
async function afterWatch(ctx: Ctx, chain: Chain, after: Chain, before: number, endT: number, more: boolean): Promise<void> {
  const ratio = chainRatio(after);
  const uid = ctx.userIds.get(chain.member)!;
  const course = ctx.courses.get(chain.course)!;
  const rng = new Rng(`${ctx.model.seed}:after:${chain.key}:${chain.seq}`);
  if (before < 0.8 && ratio >= 0.8) {
    bump(ctx, endT, "completed");
    if (rng.chance(RATES.certificate)) {
      try {
        await issueCertificate(uid, course.id, new Date(endT + MIN));
        await stamp(ctx, endT + MIN);
        bump(ctx, endT, "certificate");
      } catch (e) {
        if (!skippable(e)) throw e;
        bump(ctx, endT, "skipped_certificate");
      }
    }
    if (rng.chance(RATES.reviewCompleted)) ctx.queue.push({ kind: "review", t: endT + Math.round(rng.uniform(0.2, 72) * HOUR), member: chain.member, course: chain.course });
  } else if (before < 0.4 && ratio >= 0.4 && rng.chance(RATES.reviewAt40)) {
    ctx.queue.push({ kind: "review", t: endT + Math.round(rng.uniform(0.2, 72) * HOUR), member: chain.member, course: chain.course });
  }
  if (more) {
    const next: Chain = { ...after, seq: chain.seq + 1 };
    const t = nextSessionAt(ctx.model, next, endT);
    ctx.queue.push({ kind: "watch", t, chain: next, sessionT: t, from: 0 });
  }
}

/** 수강권이 없어 볼 수 없을 때: 구독 일시정지면 풀린 뒤 다시, 그 밖(환불·해지·만료)은 그만 본다. */
async function noAccess(ctx: Ctx, ev: Extract<Ev, { kind: "watch" }>, t: number): Promise<void> {
  const cur = ev.chain;
  bump(ctx, t, "watch_no_access");
  if (!cur.sub) return;
  const uid = ctx.userIds.get(cur.member)!;
  const s = await db.subscription.findFirst({ where: { user_id: uid, status: "paused" }, orderBy: { created_at: "desc" } });
  if (s?.paused_until) {
    const again = Math.max(t, s.paused_until.getTime()) + DAY;
    ctx.queue.push({ kind: "watch", t: again, chain: { ...cur, seq: cur.seq + 1 }, sessionT: again, from: 0 });
  }
}

// ── 사건 처리 ──
export async function handle(ctx: Ctx, ev: Ev): Promise<void> {
  resetRateLimits();
  const now = clock(ctx, ev.t);
  try {
    switch (ev.kind) {
      case "watch":
        return await watch(ctx, ev);
      case "rewatch":
        return await rewatch(ctx, ev);
      case "refund": {
        const uid = ctx.userIds.get(ev.member)!;
        const reason = REFUND_REASONS[ev.reason];
        const r = ev.target === "item" ? await requestRefund(uid, ev.id, reason, now) : await requestSubscriptionRefund(uid, ev.id, reason, now);
        await stamp(ctx, ev.t);
        bump(ctx, ev.t, `refund_requested_${ev.product}`);
        ctx.queue.push({ kind: "decide_refund", t: ev.t + Math.round(ev.decideH * HOUR), id: r.id, reject: ev.reject });
        return;
      }
      case "decide_refund":
        if (ev.reject) {
          await rejectRefund(ev.id, ctx.staffId, "수강 기록을 확인했는데 환불 규정의 조건에 맞지 않아요. 진도와 기간을 다시 확인해 주세요.");
          bump(ctx, ev.t, "refund_rejected");
        } else {
          const r = await approveRefund(ev.id, ctx.staffId, {}, now);
          bump(ctx, ev.t, r.status === "done" ? "refund_done" : "refund_approved");
        }
        await stamp(ctx, ev.t);
        return;
      case "inquiry": {
        const uid = ctx.userIds.get(ev.member)!;
        const q = await createInquiry(uid, { category: ev.category as "etc", title: ev.title, body: ev.body }, now);
        await stamp(ctx, ev.t);
        bump(ctx, ev.t, `inquiry_${ev.tag}`);
        ctx.queue.push({ kind: "answer_inquiry", t: ev.t + Math.round(ev.answerH * HOUR), id: q.id, answer: ev.answer });
        return;
      }
      case "answer_inquiry":
        await answerInquiry(`staff:${ctx.staffId}`, ev.id, ev.answer, now);
        await stamp(ctx, ev.t);
        bump(ctx, ev.t, "inquiry_answered");
        return;
      case "question": {
        const uid = ctx.userIds.get(ev.member)!;
        const course = ctx.courses.get(ev.course)!;
        const rng = new Rng(`${ctx.model.seed}:qtext:${ev.member}:${ev.course}`);
        const [title, body] = rng.pick(QUESTION_TEXTS[course.cat]);
        const q = await askQuestion(uid, { lecture_id: course.lectures[ev.lec].id, title, body }, now);
        await stamp(ctx, ev.t);
        bump(ctx, ev.t, "question");
        const u = rng.random();
        if (u < RATES.answerInstructor) {
          ctx.queue.push({ kind: "answer_question", t: ev.t + Math.round(rng.uniform(3, 96) * HOUR), id: q.id, by: "instructor", instructorId: course.instructorId, text: rng.pick(ANSWER_TEXTS.instructor) });
        } else if (u < RATES.answerInstructor + RATES.answerStaff) {
          ctx.queue.push({ kind: "answer_question", t: ev.t + Math.round(rng.uniform(1, 48) * HOUR), id: q.id, by: "staff", instructorId: "", text: ANSWER_TEXTS.staff[0] });
        }
        return;
      }
      case "answer_question":
        await answerQuestion(ev.by === "instructor" ? { kind: "instructor", id: ev.instructorId } : { kind: "staff", id: ctx.staffId }, ev.id, ev.text, now);
        await stamp(ctx, ev.t);
        bump(ctx, ev.t, `answer_${ev.by}`);
        return;
      case "review": {
        const uid = ctx.userIds.get(ev.member)!;
        const rng = new Rng(`${ctx.model.seed}:review:${ev.member}:${ev.course}`);
        const rating = RATING_SHARE[rng.index(RATING_SHARE.map((r) => r[1]))][0] as 1 | 2 | 3 | 4 | 5;
        await writeReview(uid, ev.course, { rating, body: rng.pick(REVIEW_BODIES[rating]) }, now);
        await stamp(ctx, ev.t);
        bump(ctx, ev.t, "review");
        return;
      }
      case "sub_tick":
        return await subTick(ctx, ev, now);
      case "sub_card": {
        const uid = ctx.userIds.get(ev.member)!;
        await changeCard(uid, ev.subId, ev.card, now);
        await stamp(ctx, ev.t);
        bump(ctx, ev.t, ev.card === FAIL_CARD ? "sub_card_fail_set" : "sub_card_fixed");
        return;
      }
      case "jobs": {
        const r = await runJobsOnce(now);
        await stamp(ctx, ev.t);
        for (const [k, v] of Object.entries(r)) if (v) bump(ctx, ev.t, `job_${k}`, v);
        return;
      }
      case "live_plan":
        return await livePlan(ctx, ev);
      case "live_reserve": {
        const uid = ctx.userIds.get(ev.member)!;
        await reserveSeat(uid, ev.sessionId, now);
        await stamp(ctx, ev.t);
        bump(ctx, ev.t, "live_reserved");
        if (ev.enterAt) ctx.queue.push({ kind: "live_enter", t: ev.enterAt, member: ev.member, sessionId: ev.sessionId, chatAt: ev.chatAt });
        return;
      }
      case "live_enter": {
        const uid = ctx.userIds.get(ev.member)!;
        await enterLive(uid, ev.sessionId, now);
        await stamp(ctx, ev.t);
        bump(ctx, ev.t, "live_entered");
        if (ev.chatAt) ctx.queue.push({ kind: "live_chat", t: ev.chatAt, member: ev.member, sessionId: ev.sessionId, text: ev.member % LIVE_CHATS.length });
        return;
      }
      case "live_chat": {
        const uid = ctx.userIds.get(ev.member)!;
        await postChat(uid, ev.sessionId, LIVE_CHATS[ev.text], now);
        bump(ctx, ev.t, "live_chat");
        return;
      }
      case "cert_spike":
        return await certSpike(ctx, ev.t);
      case "fault_surge":
        return await faultSurge(ctx, ev.t);
      case "compensate":
        return await compensate(ctx, ev.t);
    }
  } catch (e) {
    if (skippable(e)) {
      noteSkip(ctx, ev.t, ev.kind, e, "member" in ev ? `m${ev.member + 1}` : "");
      if (ctx.since) await stamp(ctx, ev.t);
      return;
    }
    throw e;
  }
}

// ── 구독 흐름 ──
async function subTick(ctx: Ctx, ev: Extract<Ev, { kind: "sub_tick" }>, now: Date): Promise<void> {
  const s = await db.subscription.findUnique({ where: { id: ev.subId } });
  if (!s || !["active", "past_due", "paused"].includes(s.status) || s.cancel_at_period_end) return;
  const uid = ctx.userIds.get(ev.member)!;
  const rng = new Rng(`${ctx.model.seed}:subtick:${ev.subId}:${ev.n}:do`);
  const end = s.current_period_end.getTime();
  const churn = ev.plan === "monthly" ? rng.chance(SUBS.monthlyChurn) : !rng.chance(SUBS.yearlyRenew);
  if (churn) {
    await cancelAtPeriodEnd(uid, s.id);
    await stamp(ctx, ev.t);
    bump(ctx, ev.t, `sub_cancel_${ev.plan}`);
    return;
  }
  if (s.status === "active" && rng.chance(SUBS.pause)) {
    await pause(uid, s.id, rng.int(7, 30), now);
    await stamp(ctx, ev.t);
    bump(ctx, ev.t, "sub_pause");
  }
  const after = await db.subscription.findUniqueOrThrow({ where: { id: s.id } });
  const periodEnd = after.current_period_end.getTime();
  if (rng.chance(SUBS.payFail)) {
    // 갱신(기간 끝 24시간 전) 직전에 카드가 막힌다 → 시연용 실패 카드(끝 4000)
    ctx.queue.push({ kind: "sub_card", t: Math.max(ev.t + MIN, periodEnd - 30 * HOUR), member: ev.member, subId: s.id, card: FAIL_CARD });
    if (rng.chance(SUBS.payRecover)) {
      let card = String(rng.int(1000, 9999));
      if (card === FAIL_CARD) card = "4002";
      ctx.queue.push({ kind: "sub_card", t: Math.max(ev.t + 2 * MIN, periodEnd - 24 * HOUR) + Math.round(rng.uniform(12, 108) * HOUR), member: ev.member, subId: s.id, card });
    }
  }
  const len = ev.plan === "monthly" ? 30 * DAY : 365 * DAY;
  ctx.queue.push({ ...ev, t: Math.max(periodEnd + HOUR, end) + Math.round(rng.uniform(0.1, 0.9) * len), n: ev.n + 1 });
}

// ── 라이브 ──
async function livePlan(ctx: Ctx, ev: Extract<Ev, { kind: "live_plan" }>): Promise<void> {
  const sessions = await db.liveSession.findMany({
    where: { starts_at: { gte: new Date(ev.from), lt: new Date(ev.to) }, status: { not: "cancelled" } },
    include: { course: { select: { code: true } }, instructor: { select: { slug: true } } },
  });
  const { model } = ctx;
  for (const s of sessions) {
    const rng = new Rng(`${model.seed}:live:${s.id}`);
    const starts = s.starts_at.getTime();
    const ends = s.ends_at.getTime();
    const lo = Math.max(ev.t, starts - 7 * DAY);
    const hi = starts - 15 * MIN;
    if (hi <= lo) continue;
    let pool: number[];
    let share: number;
    if (s.course) {
      const enrolled = await db.enrollment.findMany({
        where: { course_id: s.course_id!, status: "active", user: { email: { endsWith: `@${SYNTH_DOMAIN}` } } },
        select: { user: { select: { email: true } } },
      });
      pool = enrolled.map((e) => Number(/^m(\d+)@/.exec(e.user.email)![1]) - 1);
      share = LIVE_RATES.courseReserve;
    } else {
      const csat = s.title === PLANTED.csatLive.title;
      const cat: Cat = csat ? "EXAM" : (catalog().courses.find((c) => c.instructor === s.instructor.slug)?.cat ?? "DEV");
      const j = CATEGORY_CODES.indexOf(cat);
      pool = model.members.filter((m) => m.joinedAt < lo && m.catW[j] >= 0.15).map((m) => m.index);
      share = csat ? PLANTED.csatLive.reserveShare : LIVE_RATES.openReserve;
    }
    let n = 0;
    for (const mi of pool) {
      if (!rng.chance(share)) continue;
      const t = Math.round(lo + rng.random() * (hi - lo));
      const enterAt = rng.chance(LIVE_RATES.enter) ? Math.min(ends - MIN, starts - 10 * MIN + Math.round(rng.uniform(0, 30) * MIN)) : null;
      const chatAt = enterAt && rng.chance(LIVE_RATES.chat) ? Math.min(ends - MIN, enterAt + Math.round(rng.uniform(1, 40) * MIN)) : null;
      ctx.queue.push({ kind: "live_reserve", t, member: mi, sessionId: s.id, enterAt, chatAt });
      n++;
    }
    bump(ctx, ev.t, "live_planned_reservations", n);
  }
}

// ── 심어 둔 사건 ──
/** 폭주 1: 10/31 18~21시 자격증 해설 다시보기. 그 전 토요일 같은 시간 자격증 시청의 약 3배를 더해 약 4배가 되게. */
async function certSpike(ctx: Ctx, t: number): Promise<void> {
  const { model } = ctx;
  const sp = PLANTED.certSpike;
  const certIds = [...ctx.courses.values()].filter((c) => c.cat === "CERT").map((c) => c.id);
  let base = 0;
  for (let w = 1; w <= 4; w++) {
    const d = addDays(sp.date, -7 * w);
    base += await db.watchEvent.count({
      where: { course_id: { in: certIds }, created_at: { gte: kstDateTime(d, sp.fromHour), lt: kstDateTime(d, sp.toHour) }, user: { email: { endsWith: `@${SYNTH_DOMAIN}` } } },
    });
  }
  const rows = await db.lectureProgress.findMany({
    where: { course_id: { in: certIds }, last_watched_at: { lt: new Date(t) }, user: { email: { endsWith: `@${SYNTH_DOMAIN}` } } },
    select: { course_id: true, lecture_id: true, user: { select: { email: true } } },
    orderBy: [{ user_id: "asc" }, { lecture_id: "asc" }],
  });
  if (!rows.length) return;
  const codeById = new Map([...ctx.courses.values()].map((c) => [c.id, c]));
  const rng = new Rng(`${model.seed}:certspike`);
  const target = Math.max(Math.round((base / 4) * (sp.factor - 1)), Math.round(rows.length * sp.rewatchShare));
  const hourW = Object.entries(sp.hourFactors).map(([h, f]) => [Number(h), f] as const);
  for (let k = 0; k < target; k++) {
    const r = rows[rng.int(0, rows.length - 1)];
    const course = codeById.get(r.course_id)!;
    const member = Number(/^m(\d+)@/.exec(r.user.email)![1]) - 1;
    const h = hourW[rng.index(hourW.map((x) => x[1]))][0];
    ctx.queue.push({
      kind: "rewatch",
      t: kstDateTime(sp.date, h, rng.int(0, 59), rng.int(0, 59)).getTime(),
      member,
      course: course.code,
      lec: course.lectures.findIndex((l) => l.id === r.lecture_id),
      device: rng.int(0, model.members[member].devices.length - 1),
    });
  }
  bump(ctx, t, "cert_spike_planned", target);
}

/** 해설 다시보기: 이미 본 강을 1.25~1.5배로 다시 (새 진도는 거의 없고 watch_events만 는다). */
async function rewatch(ctx: Ctx, ev: Extract<Ev, { kind: "rewatch" }>): Promise<void> {
  const uid = ctx.userIds.get(ev.member)!;
  const course = ctx.courses.get(ev.course)!;
  const lec = course.lectures[ev.lec];
  const m = ctx.model.members[ev.member];
  const type = m.devices[ev.device];
  const rng = new Rng(`${ctx.model.seed}:rewatch:${ev.member}:${ev.t}`);
  const rate = rng.chance(0.5) ? 1.25 : 1.5;
  const from = 0;
  const to = Math.min(lec.duration, Math.round(rng.uniform(0.3, 1) * lec.duration));
  const dev = deviceKey(m.index, ev.device);
  try {
    await startPlayback(uid, { lecture_id: lec.id, device_id: dev }, new Date(ev.t), DEVICE_UA[type][m.index % DEVICE_UA[type].length]);
  } catch (e) {
    if (e instanceof HttpError && e.code === "NO_ACCESS") return bump(ctx, ev.t, "rewatch_no_access");
    throw e;
  }
  await stamp(ctx, ev.t, "watch");
  const te = ev.t + Math.round(((to - from) / rate) * 1000);
  await heartbeat(uid, { lecture_id: lec.id, from_sec: from, to_sec: to, position_sec: to, rate, device_id: dev }, new Date(te));
  await stamp(ctx, te, "watch");
  ctx.extra.spikeRewatch++;
  bump(ctx, ev.t, "cert_spike_rewatch");
}

/** 장애 뒤 문의 몰림: 진도가 끊긴 회원부터, 모자라면 그 무렵 수강 중인 회원. 11시에 운영팀이 같은 답으로 일괄 안내. */
async function faultSurge(ctx: Ctx, t: number): Promise<void> {
  const f = PLANTED.fault;
  const rng = new Rng(`${ctx.model.seed}:faultsurge`);
  const n = Math.max(1, rng.poisson(f.inquiries));
  const chosen: number[] = [...ctx.extra.faultUsers].slice(0, n);
  if (chosen.length < n) {
    const active = await db.enrollment.findMany({
      where: { status: "active", starts_at: { lt: new Date(t) }, user: { email: { endsWith: `@${SYNTH_DOMAIN}` } } },
      select: { user: { select: { email: true } } },
      distinct: ["user_id"],
      orderBy: { user_id: "asc" },
    });
    const pool = active.map((a) => Number(/^m(\d+)@/.exec(a.user.email)![1]) - 1).filter((x) => !chosen.includes(x));
    while (chosen.length < n && pool.length) chosen.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
  }
  const until = kstDateTime(f.date, f.inquiryUntil[0], f.inquiryUntil[1]).getTime();
  const answerAt = kstDateTime(f.date, f.answerAt[0], f.answerAt[1]).getTime();
  for (const mi of chosen) {
    const at = Math.round(t + Math.pow(rng.random(), 1.6) * (until - t));
    ctx.queue.push({
      kind: "inquiry",
      t: at,
      member: mi,
      category: FAULT_INQUIRY.category,
      title: rng.pick(FAULT_INQUIRY.titles),
      body: FAULT_INQUIRY.body,
      answer: FAULT_INQUIRY.answer,
      answerH: Math.max(0.1, (answerAt - at) / HOUR + rng.uniform(0, 1.5)),
      tag: "fault",
    });
    if (!ctx.extra.faultInquirers.includes(mi)) ctx.extra.faultInquirers.push(mi);
  }
  bump(ctx, t, "fault_inquiries_planned", chosen.length);
}

/** 다음 날 보상 쿠폰: 진도가 끊긴 회원과 문의한 회원에게 쿠폰 번호를 보낸 편지함으로 (실제 발송 없음). */
async function compensate(ctx: Ctx, t: number): Promise<void> {
  const c = PLANTED.fault.compensation;
  const who = [...new Set([...ctx.extra.faultUsers, ...ctx.extra.faultInquirers])].sort((a, b) => a - b);
  const users = await db.user.findMany({ where: { id: { in: who.map((m) => ctx.userIds.get(m)!) } } });
  await db.$transaction(
    async (tx) => {
      for (const u of users) {
        await recordMessage(
          tx, u, "compensation_coupon", "진도 저장 장애 보상 쿠폰",
          `11/2(월) 오전 영상 진도 저장 장애로 불편을 드려 죄송해요. ${c.amount.toLocaleString("ko-KR")}원 할인 쿠폰(${c.code})을 드려요. ${c.days}일 안에 결제할 때 쓸 수 있어요.`,
        );
      }
      await audit(`staff:${ctx.staffId}`, "coupon.compensate", `coupon:${c.code}`, { users: users.length } as Prisma.InputJsonValue, tx);
    },
    { timeout: 120_000 },
  );
  for (const m of who) if (!ctx.extra.sorry.includes(m)) ctx.extra.sorry.push(m);
  await stamp(ctx, t);
  bump(ctx, t, "compensation_coupons", users.length);
}

// ── 가상 데이터 세기·지우기 ──
export async function countSynthetic(): Promise<{ users: number; orders: number; staff: number }> {
  const [users, orders, staff] = await Promise.all([
    db.user.count({ where: { email: { endsWith: `@${SYNTH_DOMAIN}` } } }),
    db.order.count({ where: { user: { email: { endsWith: `@${SYNTH_DOMAIN}` } } } }),
    db.staff.count({ where: { email: SYNTH_STAFF_EMAIL } }),
  ]);
  return { users, orders, staff };
}

/**
 * 가상 데이터만 지운다 (한 트랜잭션). 가상 회원(@synth.studyon.test)과 그에 딸린 주문·결제·환불·구독·청구·수강권·
 * 진도·시청 기록·노트·수료증·질문(답변 포함)·후기·문의·보낸 편지함·기기·라이브 자리·채팅, 가상 직원과 그 작업 기록,
 * 가상 직원이 만든 지난 라이브, 가상 쿠폰(SYNTH-). 강의 평점은 남은 후기로 다시 계산하고, 주문·수료증 일련번호는
 * 남은 행에 맞춘다. 시드 강의·라이브·쿠폰 행은 지우지 않는다.
 */
export async function deleteSynthetic(): Promise<Record<string, number>> {
  return db.$transaction(
    async (tx) => {
      const staff = await tx.staff.findUnique({ where: { email: SYNTH_STAFF_EMAIL } });
      const actor = staff ? `staff:${staff.id}` : "__none__";
      const U = `SELECT id FROM users WHERE email LIKE $1`;
      const O = `SELECT id FROM orders WHERE user_id IN (${U})`;
      const S = `SELECT id FROM subscriptions WHERE user_id IN (${U})`;
      const I = `SELECT id FROM subscription_invoices WHERE subscription_id IN (${S})`;
      const n: Record<string, number> = {};
      const run = async (name: string, sql: string, ...params: unknown[]) => {
        n[name] = await tx.$executeRawUnsafe(sql, ...params);
      };
      const reviewed = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT DISTINCT course_id AS id FROM reviews WHERE user_id IN (${U})`, LIKE);
      const lives = `SELECT SUBSTRING(target FROM 6) FROM audit_logs WHERE actor = $2 AND action = 'synth.live.create'`;
      await run("live_sessions", `DELETE FROM live_sessions WHERE id IN (${lives})`, LIKE, actor);
      await run("live_chats", `DELETE FROM live_chats WHERE user_id IN (${U})`, LIKE);
      await run("live_seats", `DELETE FROM live_seats WHERE user_id IN (${U})`, LIKE);
      await run("watch_events", `DELETE FROM watch_events WHERE user_id IN (${U})`, LIKE);
      await run("lecture_progress", `DELETE FROM lecture_progress WHERE user_id IN (${U})`, LIKE);
      await run("notes", `DELETE FROM notes WHERE user_id IN (${U})`, LIKE);
      await run("certificates", `DELETE FROM certificates WHERE user_id IN (${U})`, LIKE);
      await run("questions", `DELETE FROM questions WHERE user_id IN (${U})`, LIKE); // 답변은 함께 지워진다
      await run("answers_by_staff", `DELETE FROM answers WHERE author_kind = 'staff' AND author_id = $1`, staff?.id ?? "__none__");
      await run("reviews", `DELETE FROM reviews WHERE user_id IN (${U})`, LIKE);
      await run("inquiries", `DELETE FROM inquiries WHERE user_id IN (${U})`, LIKE);
      await run("messages", `DELETE FROM messages WHERE user_id IN (${U}) OR "to" LIKE $1`, LIKE);
      await run("enrollments", `DELETE FROM enrollments WHERE user_id IN (${U})`, LIKE);
      await run("payments_refund_rows", `DELETE FROM payments WHERE refund_of_id IS NOT NULL AND (order_id IN (${O}) OR invoice_id IN (${I}))`, LIKE);
      await run("payments", `DELETE FROM payments WHERE order_id IN (${O}) OR invoice_id IN (${I})`, LIKE);
      await run("refunds", `DELETE FROM refunds WHERE user_id IN (${U})`, LIKE);
      await run("coupon_redemptions", `DELETE FROM coupon_redemptions WHERE user_id IN (${U})`, LIKE);
      await run("orders", `DELETE FROM orders WHERE user_id IN (${U})`, LIKE); // 주문 항목은 함께 지워진다
      await run("subscription_invoices", `DELETE FROM subscription_invoices WHERE subscription_id IN (${S})`, LIKE);
      await run("subscriptions", `DELETE FROM subscriptions WHERE user_id IN (${U})`, LIKE);
      await run("devices", `DELETE FROM devices WHERE user_id IN (${U})`, LIKE); // 재생 소유권·장바구니·세션은 회원과 함께
      await run("users", `DELETE FROM users WHERE email LIKE $1`, LIKE);
      await run("coupons", `DELETE FROM coupons WHERE code LIKE $1`, `${SYNTH_COUPON_PREFIX}%`);
      await run("audit_logs", `DELETE FROM audit_logs WHERE actor = $1`, actor);
      await run("staff", `DELETE FROM staff WHERE email = $1`, SYNTH_STAFF_EMAIL);
      // 일련번호: 남은 주문·수료증의 가장 큰 번호로 (없으면 그 줄을 지운다)
      await run(
        "order_counters",
        `UPDATE counters c SET last = COALESCE((SELECT MAX(CAST(SUBSTRING(code FROM 9 FOR 4) AS int)) FROM orders WHERE SUBSTRING(code FROM 3 FOR 6) = SUBSTRING(c.key FROM 7)), 0) WHERE c.key LIKE 'order:%'`,
      );
      await run(
        "certificate_counters",
        `UPDATE counters c SET last = COALESCE((SELECT MAX(CAST(SUBSTRING(number FROM 10) AS int)) FROM certificates WHERE SUBSTRING(number FROM 5 FOR 4) = SUBSTRING(c.key FROM 13)), 0) WHERE c.key LIKE 'certificate:%'`,
      );
      await tx.$executeRawUnsafe(`DELETE FROM counters WHERE last = 0 AND (key LIKE 'order:%' OR key LIKE 'certificate:%')`);
      for (const c of reviewed) await recalcRating(tx, c.id);
      return n;
    },
    { timeout: 900_000, maxWait: 30_000 },
  );
}

/**
 * 되채우기 동안 잠금(SYNTH_BACKFILL_LOCK)을 잡고 있는다. 앱의 스케줄러는 이 잠금이 잡혀 있으면 쉰다
 * (2026-11-18 사고: 앱의 결제 기한 작업이 지금 시각으로 돌며 되채우기가 막 만든 지난 시각 주문을 취소해
 * mockPay가 "이미 결제했거나 취소된 주문"으로 멈췄다). 잡은 뒤에는 이미 돌고 있던 앱 작업이 끝나기를 기다린다.
 * 다른 되채우기가 잠금을 잡고 있으면 오류. 돌려준 함수로 푼다 (프로세스가 죽으면 연결과 함께 풀린다).
 */
export async function holdBackfillLock(): Promise<() => Promise<void>> {
  let release!: () => void;
  const until = new Promise<void>((r) => (release = r));
  let held!: Promise<void>;
  const got = await new Promise<boolean>((resolve, reject) => {
    held = db
      .$transaction(
        async (tx) => {
          const r = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${SYNTH_BACKFILL_LOCK})) AS ok`;
          const ok = !!r[0]?.ok;
          resolve(ok);
          if (ok) await until;
        },
        { timeout: 48 * 3600_000, maxWait: 30_000 },
      )
      .catch((e) => reject(e));
  });
  if (!got) throw new Error("다른 되채우기가 이 DB에서 돌고 있어요. 끝난 뒤에 다시 해 주세요.");
  // 이미 돌고 있던 앱 주기 작업이 끝나기를 기다린다 (작업 잠금을 잡았다 바로 놓는다)
  for (const name of Object.keys(JOBS)) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job:${name}`}))`;
    });
  }
  return async () => {
    release();
    await held;
  };
}

/** 앱의 주기 작업이 최근에 돌았는지 (되채우기는 앱 작업이 멈춘 동안만). */
export async function recentJobRun(withinMs: number): Promise<Date | null> {
  const r = await db.jobRun.findFirst({ where: { started_at: { gte: new Date(Date.now() - withinMs) } }, orderBy: { started_at: "desc" } });
  return r?.started_at ?? null;
}

/** 이 프로세스에서만: 모의 결제(토스 키 비움), 하트비트 주기 1800초. 끝나면 되돌린다. */
export async function withSynthEnv<T>(fn: () => Promise<T>): Promise<T> {
  const { resetEnvCache } = await import("@/server/env");
  const keep = { a: process.env.TOSS_CLIENT_KEY, b: process.env.TOSS_SECRET_KEY, c: process.env.NEXT_PUBLIC_HEARTBEAT_SEC };
  process.env.TOSS_CLIENT_KEY = "";
  process.env.TOSS_SECRET_KEY = "";
  process.env.NEXT_PUBLIC_HEARTBEAT_SEC = String(HEARTBEAT_SEC_FOR_SYNTH);
  resetEnvCache();
  try {
    return await fn();
  } finally {
    const put = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
    put("TOSS_CLIENT_KEY", keep.a);
    put("TOSS_SECRET_KEY", keep.b);
    put("NEXT_PUBLIC_HEARTBEAT_SEC", keep.c);
    resetEnvCache();
  }
}

export { db, SYNTH_DEVICE_PREFIX };
