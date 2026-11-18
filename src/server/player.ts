import type { Course, Enrollment, Lecture } from "@prisma/client";
import { type Range, acceptSegment, addWatched, courseProgress, isAllowedRate, lectureDone } from "@/rules/progress";
import { enforceLimit } from "./auth/ratelimit";
import { db } from "./db";
import { registerDevice } from "./devices";
import { activeEnrollment } from "./enrollments";
import { getEnv } from "./env";
import { grantSubscriptionAccess } from "./subscriptions";
import { HttpError } from "./http";
import type { Tx } from "./tx";

/** "동시 재생 수" 지표: 최근 60초 안에 하트비트가 온 소유권. */
const ACTIVE_WINDOW_MS = 60_000;
/** 쉬었다 와도 하트비트 한 번에 쳐 줄 수 있는 최대 경과 = 주기 × 3 (오래 멈춘 뒤 끝으로 끌어도 쌓인 시간을 못 쓰게). */
const IDLE_CAP_BEATS = 3;

export const heartbeatSec = () => getEnv().NEXT_PUBLIC_HEARTBEAT_SEC;

/** 한 계정의 하트비트 한도(분당): 정상 주기의 두 배 + 일시정지·창 닫기 여유. 넘으면 429. */
export const heartbeatLimitPerMin = (hb = heartbeatSec()) => Math.ceil(60 / hb) * 2 + 6;

const NO_ACCESS = () => new HttpError(403, "NO_ACCESS", "수강권이 있어야 볼 수 있어요.");

export type LectureAccess = { lecture: Lecture; course: Course; enrollment: Enrollment | null; preview: boolean };

/**
 * 이 강을 볼 수 있는지.
 * 미리보기 강은 누구나(공개 강의만) 볼 수 있고, 그 밖에는 지금 살아 있는 수강권이 있어야 한다(없으면 403 NO_ACCESS).
 * 구독 대상 강의에 활성 구독이 있으면 여기서 구독 수강권을 만든다.
 */
export async function lectureAccess(userId: string | null, lectureId: string, now: Date = new Date()): Promise<LectureAccess> {
  const lecture = await db.lecture.findUnique({ where: { id: lectureId }, include: { course: true } });
  if (!lecture) throw new HttpError(404, "NOT_FOUND", "강을 찾지 못했어요.");
  const { course, ...lec } = lecture;
  // 구매·무료 수강권이 살아 있으면 그것, 아니면 구독(active·past_due)으로 지연 생성 (M5 grantSubscriptionAccess와 같은 함수)
  const enrollment = userId ? ((await activeEnrollment(userId, course.id, now)) ?? (await grantSubscriptionAccess(userId, course.id, now))) : null;
  const preview = lec.is_preview && course.status === "published";
  if (!enrollment && !preview) throw NO_ACCESS();
  return { lecture: lec, course, enrollment, preview: !enrollment && preview };
}

type Db = Tx | typeof db;

/** 강의 진도율(완료한 강 길이 기준)과 강별 상태. */
export async function courseProgressFor(c: Db, userId: string, courseId: string) {
  const [lectures, progress] = await Promise.all([
    c.lecture.findMany({ where: { course_id: courseId }, select: { id: true, duration_sec: true }, orderBy: { sort: "asc" } }),
    c.lectureProgress.findMany({ where: { user_id: userId, course_id: courseId } }),
  ]);
  const by = new Map(progress.map((p) => [p.lecture_id, p]));
  const rows = lectures.map((l) => {
    const p = by.get(l.id);
    const done = !!p && (p.completed_at !== null || lectureDone(p.watched_sec, l.duration_sec));
    return { lecture_id: l.id, duration_sec: l.duration_sec, done, watched_sec: p?.watched_sec ?? 0 };
  });
  return { ratio: courseProgress(rows), lectures: rows };
}

/** 이어보기 위치: 끝 근처(5초 안)까지 봤으면 처음부터. */
const resumeFrom = (pos: number, duration: number) => (pos >= duration - 5 ? 0 : Math.max(0, pos));

/**
 * 재생 시작: 기기를 등록하고(2대 제한) 재생 소유권을 가져온다(앞 기기를 밀어낸다).
 * 미리보기만 보는 사람(수강권 없음)은 기기·소유권을 쓰지 않는다(lease=false).
 */
export async function startPlayback(
  userId: string | null,
  body: { lecture_id: string; device_id: string },
  now: Date = new Date(),
  userAgent: string | null = null,
): Promise<{ resume_sec: number; lease: boolean }> {
  const acc = await lectureAccess(userId, body.lecture_id, now);
  if (!acc.enrollment || !userId) return { resume_sec: 0, lease: false };
  return db.$transaction(async (tx) => {
    const device = await registerDevice(tx, userId, body.device_id, userAgent, now);
    await tx.playbackLease.upsert({
      where: { user_id: userId },
      create: { user_id: userId, device_id: device.id, lecture_id: acc.lecture.id, beat_at: now },
      update: { device_id: device.id, lecture_id: acc.lecture.id, beat_at: now },
    });
    const p = await tx.lectureProgress.findUnique({ where: { user_id_lecture_id: { user_id: userId, lecture_id: acc.lecture.id } } });
    return { resume_sec: resumeFrom(p?.last_position_sec ?? 0, acc.lecture.duration_sec), lease: true };
  });
}

export type HeartbeatBody = { lecture_id: string; from_sec: number; to_sec: number; position_sec: number; rate: number; device_id: string };
export type HeartbeatResult = { watched_sec: number; done: boolean; course_progress: number; added_sec: number };

function parseRanges(v: unknown): Range[] {
  if (!Array.isArray(v)) return [];
  return v.filter((r): r is Range => Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]));
}

/**
 * 하트비트: 지난 하트비트 뒤 실제로 재생된 구간을 받아 본 구간에 합친다.
 * - 배속이 RATES 밖이면 400 BAD_RATE.
 * - 소유권 기기가 아니면 409 PLAYING_ELSEWHERE (다른 기기가 시작했다).
 * - 구간은 실제로 흐른 시간 × 배속만큼만 받는다(acceptSegment). 같은 구간은 한 번만 센다(addWatched).
 * - lecture_progress를 FOR UPDATE로 잠그므로 재시도·동시 도착에도 본 초가 한 번만 는다.
 * - watch_events에는 이번에 새로 더해진 초(added_sec)만 쓴다. 0이어도 행은 남긴다(분석용).
 * - 미리보기만 보는 사람은 진도를 저장하지 않고 200.
 */
export async function heartbeat(userId: string | null, body: HeartbeatBody, now: Date = new Date()): Promise<HeartbeatResult> {
  if (!isAllowedRate(body.rate)) throw new HttpError(400, "BAD_RATE", "배속은 0.5배에서 2배 사이로 골라 주세요.");
  const hb = heartbeatSec();
  if (userId) enforceLimit(`heartbeat:${userId}`, heartbeatLimitPerMin(hb), 60, now.getTime());
  const acc = await lectureAccess(userId, body.lecture_id, now);
  if (!acc.enrollment || !userId) return { watched_sec: 0, done: false, course_progress: 0, added_sec: 0 };
  const { lecture, course, enrollment } = acc;

  return db.$transaction(
    async (tx) => {
      const device = await tx.device.findFirst({ where: { user_id: userId, device_key: body.device_id, revoked_at: null } });
      if (!device) throw new HttpError(409, "DEVICE_NOT_REGISTERED", "이 기기는 등록돼 있지 않아요. 다시 재생해 주세요.");
      const leases = await tx.$queryRaw<{ device_id: string; beat_at: Date }[]>`
        SELECT device_id, beat_at FROM playback_leases WHERE user_id = ${userId} FOR UPDATE`;
      const lease = leases[0];
      if (lease && lease.device_id !== device.id) {
        throw new HttpError(409, "PLAYING_ELSEWHERE", "다른 기기에서 재생을 시작해서 여기서는 멈췄어요.");
      }
      const floor = new Date(now.getTime() - IDLE_CAP_BEATS * hb * 1000);
      const ref = lease ? (lease.beat_at > floor ? lease.beat_at : floor) : null;
      const seg = acceptSegment([body.from_sec, body.to_sec], body.rate, ref, now, hb);

      await tx.lectureProgress.createMany({
        data: [{ user_id: userId, lecture_id: lecture.id, course_id: course.id, last_watched_at: now }],
        skipDuplicates: true,
      });
      const rows = await tx.$queryRaw<{ id: string; ranges: unknown; completed_at: Date | null }[]>`
        SELECT id, ranges, completed_at FROM lecture_progress WHERE user_id = ${userId} AND lecture_id = ${lecture.id} FOR UPDATE`;
      const p = rows[0];
      const r = addWatched(parseRanges(p.ranges), seg ?? [0, 0], lecture.duration_sec);
      const done = lectureDone(r.watched_sec, lecture.duration_sec);
      const position = Math.min(lecture.duration_sec, Math.max(0, Math.floor(body.position_sec)));
      await tx.lectureProgress.update({
        where: { id: p.id },
        data: {
          ranges: r.ranges,
          watched_sec: r.watched_sec,
          last_position_sec: position,
          last_watched_at: now,
          completed_at: p.completed_at ?? (done ? now : null),
        },
      });
      await tx.watchEvent.create({
        data: {
          user_id: userId,
          lecture_id: lecture.id,
          course_id: course.id,
          device_id: device.id,
          from_sec: Math.max(0, Math.floor(body.from_sec)),
          to_sec: Math.max(0, Math.floor(body.to_sec)),
          rate: body.rate,
          added_sec: r.added_sec,
          source: enrollment.source,
          created_at: now,
        },
      });
      await tx.playbackLease.upsert({
        where: { user_id: userId },
        create: { user_id: userId, device_id: device.id, lecture_id: lecture.id, beat_at: now },
        update: { device_id: device.id, lecture_id: lecture.id, beat_at: now },
      });
      await tx.device.update({ where: { id: device.id }, data: { last_seen_at: now } });
      const cp = await courseProgressFor(tx, userId, course.id);
      return { watched_sec: r.watched_sec, done: done || p.completed_at !== null, course_progress: cp.ratio, added_sec: r.added_sec };
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
}

/** 자료 받기: 처음 한 번만 downloaded_at을 넣는다(환불 때 이 강은 본 것으로 계산). 수강권이 있어야 한다. */
export async function markDownloaded(userId: string, lectureId: string, now: Date = new Date()): Promise<Lecture> {
  const acc = await lectureAccess(userId, lectureId, now);
  if (!acc.enrollment) throw NO_ACCESS();
  if (!acc.lecture.has_resource) throw new HttpError(404, "NO_RESOURCE", "이 강에는 받을 자료가 없어요.");
  await db.lectureProgress.createMany({
    data: [{ user_id: userId, lecture_id: lectureId, course_id: acc.course.id, downloaded_at: now, last_watched_at: now }],
    skipDuplicates: true,
  });
  await db.lectureProgress.updateMany({ where: { user_id: userId, lecture_id: lectureId, downloaded_at: null }, data: { downloaded_at: now } });
  return acc.lecture;
}

/** 동시 재생 수: 최근 60초 안에 하트비트가 온 재생 소유권 수 (Task 20 지표). */
export async function activePlaybacks(now: Date = new Date()): Promise<number> {
  return db.playbackLease.count({ where: { beat_at: { gt: new Date(now.getTime() - ACTIVE_WINDOW_MS) } } });
}

export type PlayerLecture = { id: string; title: string; sort: number; duration_sec: number; is_preview: boolean; has_resource: boolean; done: boolean; watched_sec: number };

/** 플레이어 화면·재생 정보 API가 쓰는 정보 (강·강의·커리큘럼·진도·이어보기). */
export async function playerInfo(userId: string | null, lectureId: string, now: Date = new Date()) {
  const acc = await lectureAccess(userId, lectureId, now);
  const { lecture, course, enrollment } = acc;
  const [sections, category, progress, mine] = await Promise.all([
    db.section.findMany({ where: { course_id: course.id }, orderBy: { sort: "asc" }, include: { lectures: { orderBy: { sort: "asc" } } } }),
    db.category.findUnique({ where: { id: course.category_id } }),
    userId && enrollment ? courseProgressFor(db, userId, course.id) : null,
    userId && enrollment ? db.lectureProgress.findUnique({ where: { user_id_lecture_id: { user_id: userId, lecture_id: lecture.id } } }) : null,
  ]);
  const by = new Map((progress?.lectures ?? []).map((l) => [l.lecture_id, l]));
  return {
    lecture: {
      id: lecture.id,
      title: lecture.title,
      sort: lecture.sort,
      duration_sec: lecture.duration_sec,
      is_preview: lecture.is_preview,
      has_resource: lecture.has_resource,
      script: lecture.script,
    },
    course: { id: course.id, code: course.code, title: course.title, category: category?.code ?? "DEV" },
    enrolled: !!enrollment,
    preview: acc.preview,
    resume_sec: resumeFrom(mine?.last_position_sec ?? 0, lecture.duration_sec),
    downloaded: !!mine?.downloaded_at,
    course_progress: progress?.ratio ?? 0,
    sections: sections.map((s) => ({
      title: s.title,
      sort: s.sort,
      lectures: s.lectures.map(
        (l): PlayerLecture => ({
          id: l.id,
          title: l.title,
          sort: l.sort,
          duration_sec: l.duration_sec,
          is_preview: l.is_preview,
          has_resource: l.has_resource,
          done: by.get(l.id)?.done ?? false,
          watched_sec: by.get(l.id)?.watched_sec ?? 0,
        }),
      ),
    })),
  };
}

export type PlayerInfo = Awaited<ReturnType<typeof playerInfo>>;
