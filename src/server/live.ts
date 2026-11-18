import { Prisma, type Lecture, type LiveChat, type LiveSeat, type LiveSession } from "@prisma/client";
import { kstDate } from "@/rules/time";
import { audit } from "./audit";
import { LIMITS, enforceLimit } from "./auth/ratelimit";
import { db } from "./db";
import { HttpError } from "./http";
import { courseAccess } from "./subscriptions";
import type { Tx } from "./tx";

/** 라이브: 예약(정원)·입장(시작 10분 전부터)·채팅·상태 작업·다시보기. */
export const ENTRY_OPENS_BEFORE_MS = 10 * 60_000;
export const CHAT_MAX = 200;
const CLOSED = ["ended", "cancelled"];

const NOT_FOUND = () => new HttpError(404, "NOT_FOUND", "라이브를 찾지 못했어요.");
const CLOSED_ERR = () => new HttpError(409, "LIVE_CLOSED", "끝났거나 취소된 라이브예요.");

async function lockSession(tx: Tx, id: string): Promise<LiveSession> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM live_sessions WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw NOT_FOUND();
  return tx.liveSession.findUniqueOrThrow({ where: { id } });
}

const seatOf = (userId: string, sessionId: string) =>
  db.liveSeat.findUnique({ where: { session_id_user_id: { session_id: sessionId, user_id: userId } } });

/**
 * 자리 예약. 세션 행을 잠그고(FOR UPDATE) 정원을 센다: 동시에 몰려도 정원을 넘지 않는다.
 * 강의에 붙은 라이브는 그 강의 수강권이 있어야 한다(구독 대상이면 구독으로도 된다). 단독 라이브는 회원이면 누구나.
 * 이미 예약했으면 그 자리를 돌려준다.
 */
export async function reserveSeat(userId: string, sessionId: string, now: Date = new Date()): Promise<LiveSeat> {
  const s0 = await db.liveSession.findUnique({ where: { id: sessionId } });
  if (!s0) throw NOT_FOUND();
  if (s0.course_id) {
    try {
      await courseAccess(userId, s0.course_id, now);
    } catch (e) {
      if (e instanceof HttpError && e.status === 403) throw new HttpError(403, "NO_ACCESS", "이 라이브는 강의 수강생만 예약할 수 있어요.");
      throw e;
    }
  }
  try {
    return await db.$transaction(async (tx) => {
      const s = await lockSession(tx, sessionId);
      const mine = await tx.liveSeat.findUnique({ where: { session_id_user_id: { session_id: s.id, user_id: userId } } });
      if (mine) return mine;
      if (CLOSED.includes(s.status) || s.ends_at <= now) throw CLOSED_ERR();
      const taken = await tx.liveSeat.count({ where: { session_id: s.id } });
      if (taken >= s.capacity) throw new HttpError(409, "LIVE_FULL", "예약이 다 찼어요.");
      return tx.liveSeat.create({ data: { session_id: s.id, user_id: userId, reserved_at: now } });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const seat = await seatOf(userId, sessionId);
      if (seat) return seat;
    }
    throw e;
  }
}

/**
 * 입장. 자리가 있어야 하고(없으면 403 NO_SEAT), 시작 10분 전부터 끝날 때까지.
 * 처음 들어온 시각을 entered_at에 남긴다. 대기열(Task 22)은 이 앞에 선다.
 */
export async function enterLive(userId: string, sessionId: string, now: Date = new Date()): Promise<{ room_url: string }> {
  const s = await db.liveSession.findUnique({ where: { id: sessionId } });
  if (!s) throw NOT_FOUND();
  const seat = await seatOf(userId, sessionId);
  if (!seat) throw new HttpError(403, "NO_SEAT", "예약한 분만 들어올 수 있어요. 먼저 자리를 예약해 주세요.");
  if (CLOSED.includes(s.status) || s.ends_at <= now) throw CLOSED_ERR();
  if (now.getTime() < s.starts_at.getTime() - ENTRY_OPENS_BEFORE_MS) {
    throw new HttpError(409, "NOT_YET", "입장은 시작 10분 전부터 할 수 있어요.");
  }
  if (!seat.entered_at) await db.liveSeat.updateMany({ where: { id: seat.id, entered_at: null }, data: { entered_at: now } });
  liveBeat(sessionId, userId, now);
  return { room_url: `/live/${sessionId}/room` };
}

/** 입장한 사람인지 (채팅·방 화면·SSE). */
export async function hasEntered(userId: string, sessionId: string): Promise<boolean> {
  const seat = await seatOf(userId, sessionId);
  return !!seat?.entered_at;
}

/** 채팅 쓰기: 입장한 사람만, 1~200자, 계정당 30회/분. */
export async function postChat(userId: string, sessionId: string, body: string, now: Date = new Date()): Promise<LiveChat> {
  const text = body.trim();
  if (!text || [...text].length > CHAT_MAX) throw new HttpError(400, "BAD_INPUT", "채팅은 1~200자로 적어 주세요.");
  const s = await db.liveSession.findUnique({ where: { id: sessionId } });
  if (!s) throw NOT_FOUND();
  if (!(await hasEntered(userId, sessionId))) throw new HttpError(403, "NOT_ENTERED", "라이브에 입장한 뒤에 채팅할 수 있어요.");
  if (CLOSED.includes(s.status)) throw CLOSED_ERR();
  enforceLimit(`chat:user:${userId}`, ...LIMITS.chat, now.getTime());
  liveBeat(sessionId, userId, now);
  return db.liveChat.create({ data: { session_id: sessionId, user_id: userId, body: text, created_at: now } });
}

/** afterId 뒤의 채팅 (오래된 것부터). afterId가 없으면 최근 50개. */
export async function chatSince(sessionId: string, afterId: number | null): Promise<LiveChat[]> {
  if (afterId === null) {
    const last = await db.liveChat.findMany({ where: { session_id: sessionId }, orderBy: { id: "desc" }, take: 50 });
    return last.reverse();
  }
  return db.liveChat.findMany({ where: { session_id: sessionId, id: { gt: afterId } }, orderBy: { id: "asc" }, take: 200 });
}

/** 화면에 내보내는 채팅 모양 (이름은 가린다). */
export async function chatView(chats: LiveChat[]) {
  const ids = [...new Set(chats.map((c) => c.user_id))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, maskName(u.name)]));
  return chats.map((c) => ({ id: c.id, body: c.body, name: names.get(c.user_id) ?? "수강생", at: c.created_at.toISOString() }));
}

function maskName(name: string): string {
  const s = [...name];
  if (s.length <= 1) return "*";
  if (s.length === 2) return `${s[0]}*`;
  return `${s[0]}${"*".repeat(s.length - 2)}${s[s.length - 1]}`;
}

// ───────────────────────── 시청자 수 (앱 메모리) ─────────────────────────

const VIEWER_WINDOW_MS = 60_000;
const beats = new Map<string, Map<string, number>>();

/** 방에 있는 사람의 하트비트 (입장·채팅·SSE 주기마다). */
export function liveBeat(sessionId: string, userId: string, now: Date = new Date()): void {
  let m = beats.get(sessionId);
  if (!m) beats.set(sessionId, (m = new Map()));
  m.set(userId, now.getTime());
}

/** 최근 60초 안에 하트비트가 있었던 사람 수. */
export function liveViewers(sessionId: string, now: Date = new Date()): number {
  const m = beats.get(sessionId);
  if (!m) return 0;
  const from = now.getTime() - VIEWER_WINDOW_MS;
  for (const [u, t] of m) if (t <= from) m.delete(u);
  if (!m.size) beats.delete(sessionId);
  return m.size;
}

// ───────────────────────── 상태 작업·다시보기 ─────────────────────────

/** scheduled → live(시작 시각), live → ended(끝 시각). 끝 시각까지 지난 scheduled는 바로 ended. 바꾼 수. */
export async function advanceLiveStatus(now: Date): Promise<number> {
  const missed = await db.liveSession.updateMany({ where: { status: "scheduled", ends_at: { lte: now } }, data: { status: "ended" } });
  const started = await db.liveSession.updateMany({ where: { status: "scheduled", starts_at: { lte: now } }, data: { status: "live" } });
  const ended = await db.liveSession.updateMany({ where: { status: "live", ends_at: { lte: now } }, data: { status: "ended" } });
  return missed.count + started.count + ended.count;
}

/**
 * 끝난 라이브를 강의의 다시보기 강으로 붙인다. 길이 = 끝 − 시작, 스크립트는 "다시보기".
 * 이미 붙였으면 그 강을 돌려준다.
 */
export async function attachReplay(actor: string, sessionId: string, sectionId: string): Promise<Lecture> {
  return db.$transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    if (!s.course_id) throw new HttpError(400, "NO_COURSE", "강의에 붙은 라이브만 다시보기로 붙일 수 있어요.");
    if (s.status !== "ended") throw new HttpError(409, "NOT_ENDED", "끝난 라이브만 다시보기로 붙일 수 있어요.");
    if (s.replay_lecture_id) {
      const existing = await tx.lecture.findUnique({ where: { id: s.replay_lecture_id } });
      if (existing) return existing;
    }
    const section = await tx.section.findUnique({ where: { id: sectionId } });
    if (!section || section.course_id !== s.course_id) throw new HttpError(400, "BAD_SECTION", "이 라이브가 붙은 강의의 섹션을 골라 주세요.");
    const max = await tx.lecture.aggregate({ where: { course_id: s.course_id }, _max: { sort: true } });
    const duration = Math.max(1, Math.round((s.ends_at.getTime() - s.starts_at.getTime()) / 1000));
    const day = kstDate(s.starts_at);
    const lecture = await tx.lecture.create({
      data: {
        section_id: section.id,
        course_id: s.course_id,
        title: `[다시보기] ${s.title}`.slice(0, 200),
        sort: (max._max.sort ?? 0) + 1,
        duration_sec: duration,
        script: {
          slides: [{ at: 0, title: "다시보기", bullets: [s.title, `${day} 라이브`] }],
          captions: [{ at: 0, text: `${day}에 진행한 라이브 다시보기예요.` }],
        },
      },
    });
    await tx.liveSession.update({ where: { id: s.id }, data: { replay_lecture_id: lecture.id } });
    await audit(actor, "live.replay", `live:${s.id}`, { lecture_id: lecture.id, section_id: section.id }, tx);
    return lecture;
  });
}
