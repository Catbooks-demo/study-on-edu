import type { Answer, Question } from "@prisma/client";
import { questionOverdue } from "@/rules/deadlines";
import { LIMITS, enforceLimit } from "./auth/ratelimit";
import { maskName } from "./catalog";
import { db } from "./db";
import { HttpError } from "./http";
import { recordMessage } from "./messages";
import { lectureAccess } from "./player";

export type QaAuthor = { kind: "instructor" | "staff"; id: string };

/** 강별 질문. 그 강의 수강권이 있어야 한다. 쓰기 제한: 계정 10회/10분. */
export async function askQuestion(userId: string, input: { lecture_id: string; title: string; body: string }, now: Date = new Date()): Promise<Question> {
  enforceLimit(`question:user:${userId}`, ...LIMITS.write, now.getTime());
  const acc = await lectureAccess(userId, input.lecture_id, now);
  if (!acc.enrollment) throw new HttpError(403, "NO_ACCESS", "수강권이 있어야 질문할 수 있어요.");
  return db.question.create({
    data: {
      lecture_id: acc.lecture.id,
      course_id: acc.course.id,
      user_id: userId,
      title: input.title.trim(),
      body: input.body.trim(),
      created_at: now,
    },
  });
}

/**
 * 답변 (강사·직원). 강사는 자기 강의 질문에만 답할 수 있고 아니면 403.
 * 답하면 answered_at을 넣고(처음 답한 시각) 질문자에게 안내를 남긴다.
 */
export async function answerQuestion(author: QaAuthor, questionId: string, body: string, now: Date = new Date()): Promise<Answer> {
  enforceLimit(`answer:${author.kind}:${author.id}`, ...LIMITS.write, now.getTime());
  const q = await db.question.findUnique({ where: { id: questionId }, include: { course: true, user: true } });
  if (!q) throw new HttpError(404, "NOT_FOUND", "질문을 찾지 못했어요.");
  if (author.kind === "instructor" && q.course.instructor_id !== author.id) {
    throw new HttpError(403, "FORBIDDEN", "내 강의의 질문에만 답할 수 있어요.");
  }
  return db.$transaction(async (tx) => {
    const a = await tx.answer.create({ data: { question_id: q.id, author_kind: author.kind, author_id: author.id, body: body.trim(), created_at: now } });
    await tx.question.updateMany({ where: { id: q.id, answered_at: null }, data: { answered_at: now } });
    await recordMessage(
      tx, q.user, "question_answered", "질문에 답변이 달렸어요",
      `「${q.course.title}」에 남긴 질문 "${q.title.slice(0, 30)}"에 답변이 달렸어요. 내 강의실 › 내 질문에서 확인해 주세요.`,
    );
    return a;
  });
}

/** 질문 목록 (최신순). overdue = 7일 넘게 답이 없음. */
export async function listQuestions(
  filter: { courseIds?: string[]; lectureId?: string; userId?: string; unansweredOnly?: boolean; take?: number },
  now: Date = new Date(),
) {
  const rows = await db.question.findMany({
    where: {
      ...(filter.courseIds ? { course_id: { in: filter.courseIds } } : {}),
      ...(filter.lectureId ? { lecture_id: filter.lectureId } : {}),
      ...(filter.userId ? { user_id: filter.userId } : {}),
      ...(filter.unansweredOnly ? { answered_at: null } : {}),
    },
    include: {
      answers: { orderBy: { created_at: "asc" } },
      user: { select: { name: true } },
      lecture: { select: { title: true, sort: true } },
      course: { select: { code: true, title: true } },
    },
    orderBy: { created_at: "desc" },
    take: filter.take ?? 200,
  });
  return rows.map((q) => ({ ...q, overdue: questionOverdue(q.created_at, q.answered_at, now) }));
}

type QuestionRow = Awaited<ReturnType<typeof listQuestions>>[number];

const AUTHOR_LABEL: Record<string, string> = { instructor: "강사", staff: "운영팀" };

/** 수강생 화면용 (이름은 가린다). */
export const questionView = (q: QuestionRow, viewerId?: string) => ({
  id: q.id,
  lecture_id: q.lecture_id,
  lecture_title: q.lecture.title,
  lecture_sort: q.lecture.sort,
  course_code: q.course.code,
  course_title: q.course.title,
  title: q.title,
  body: q.body,
  author: maskName(q.user.name),
  mine: viewerId !== undefined && q.user_id === viewerId,
  created_at: q.created_at.toISOString(),
  answered_at: q.answered_at?.toISOString() ?? null,
  overdue: q.overdue,
  answers: q.answers.map((a) => ({ id: a.id, author: AUTHOR_LABEL[a.author_kind] ?? a.author_kind, body: a.body, created_at: a.created_at.toISOString() })),
});
