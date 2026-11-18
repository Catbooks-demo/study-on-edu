import { Prisma, type Certificate } from "@prisma/client";
import { isCompleted } from "@/rules/progress";
import { nextCertificateNo } from "./codes";
import { db } from "./db";
import { HttpError } from "./http";
import { courseProgressFor } from "./player";

/**
 * 수료증 발급. 진도율(완료한 강 길이 기준) 80% 미만이면 409 NOT_COMPLETED.
 * 이미 있으면 그것을 돌려준다(멱등). 동시에 눌러도 (수강생, 강의) unique로 하나만 남고 번호도 건너뛰지 않는다.
 */
export async function issueCertificate(userId: string, courseId: string, now: Date = new Date()): Promise<Certificate> {
  const existing = await db.certificate.findUnique({ where: { user_id_course_id: { user_id: userId, course_id: courseId } } });
  if (existing) return existing;
  const e = await db.enrollment.findUnique({ where: { user_id_course_id: { user_id: userId, course_id: courseId } } });
  if (!e || e.status === "refunded") throw new HttpError(403, "NO_ACCESS", "수강한 강의만 수료증을 받을 수 있어요.");
  const { ratio } = await courseProgressFor(db, userId, courseId);
  if (!isCompleted(ratio)) throw new HttpError(409, "NOT_COMPLETED", "진도율 80%를 넘으면 수료증을 받을 수 있어요.");
  try {
    return await db.$transaction(async (tx) => {
      const number = await nextCertificateNo(tx, now);
      return tx.certificate.create({ data: { number, user_id: userId, course_id: courseId, issued_at: now, progress_ratio: ratio } });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return db.certificate.findUniqueOrThrow({ where: { user_id_course_id: { user_id: userId, course_id: courseId } } });
    }
    throw err;
  }
}

/** 수료증 보기 (본인 것만, 아니면 null). */
export async function getCertificate(number: string, userId: string) {
  const c = await db.certificate.findUnique({
    where: { number },
    include: {
      user: { select: { name: true } },
      course: { select: { code: true, title: true, instructor: { select: { display_name: true } }, lectures: { select: { duration_sec: true } } } },
    },
  });
  if (!c || c.user_id !== userId) return null;
  return c;
}

export const certificateView = (c: Certificate) => ({
  number: c.number,
  course_id: c.course_id,
  issued_at: c.issued_at.toISOString(),
  progress_ratio: c.progress_ratio,
});
