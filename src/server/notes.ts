import type { Note } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./http";
import { lectureAccess } from "./player";

export const NOTE_MAX = 2000;

function cleanBody(body: string): string {
  const b = body.trim();
  if (!b) throw new HttpError(400, "BAD_INPUT", "노트 내용을 적어 주세요.");
  if (b.length > NOTE_MAX) throw new HttpError(400, "BAD_INPUT", "노트는 2,000자까지 적을 수 있어요.");
  return b;
}

/** 강의 시점 노트. 수강권이 있어야 한다. 시점은 강 길이 안으로 자른다. */
export async function addNote(userId: string, input: { lecture_id: string; at_sec: number; body: string }, now: Date = new Date()): Promise<Note> {
  const body = cleanBody(input.body);
  const acc = await lectureAccess(userId, input.lecture_id, now);
  if (!acc.enrollment) throw new HttpError(403, "NO_ACCESS", "수강권이 있어야 볼 수 있어요.");
  const at_sec = Math.min(acc.lecture.duration_sec, Math.max(0, Math.floor(input.at_sec)));
  return db.note.create({ data: { user_id: userId, lecture_id: acc.lecture.id, course_id: acc.course.id, at_sec, body } });
}

/** 내 노트 (강의 하나 또는 전체). 강의·강 순서, 시점 순. */
export async function listNotes(userId: string, courseId?: string) {
  return db.note.findMany({
    where: { user_id: userId, ...(courseId ? { course_id: courseId } : {}) },
    include: {
      lecture: { select: { id: true, title: true, sort: true } },
      course: { select: { id: true, code: true, title: true } },
    },
    orderBy: [{ course_id: "asc" }, { lecture: { sort: "asc" } }, { at_sec: "asc" }, { created_at: "asc" }],
  });
}

async function ownNote(userId: string, id: string): Promise<Note> {
  const n = await db.note.findUnique({ where: { id } });
  if (!n || n.user_id !== userId) throw new HttpError(404, "NOT_FOUND", "노트를 찾지 못했어요.");
  return n;
}

export async function updateNote(userId: string, id: string, body: string): Promise<Note> {
  await ownNote(userId, id);
  return db.note.update({ where: { id }, data: { body: cleanBody(body) } });
}

export async function deleteNote(userId: string, id: string): Promise<void> {
  await ownNote(userId, id);
  await db.note.delete({ where: { id } });
}

type NoteRow = Awaited<ReturnType<typeof listNotes>>[number];

export const noteView = (n: NoteRow | Note) => ({
  id: n.id,
  lecture_id: n.lecture_id,
  course_id: n.course_id,
  at_sec: n.at_sec,
  body: n.body,
  created_at: n.created_at.toISOString(),
  ...("lecture" in n ? { lecture_title: n.lecture.title, lecture_sort: n.lecture.sort, course_code: n.course.code, course_title: n.course.title } : {}),
});
