import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/server/roles";
import { INSTRUCTOR_COOKIE, STAFF_COOKIE, instructorFromToken, staffFromToken } from "@/server/auth/session";
import { HttpError, readCookie, readJson, route } from "@/server/http";
import { type QaAuthor, answerQuestion } from "@/server/qa";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ body: z.string().trim().min(2, "답변을 적어 주세요.").max(5000, "답변은 5,000자까지 적을 수 있어요.") });

/** 강사(자기 강의만) 또는 직원(권한 support)이 답한다. */
async function author(req: Request): Promise<QaAuthor> {
  const inst = await instructorFromToken(readCookie(req, INSTRUCTOR_COOKIE));
  if (inst) return { kind: "instructor", id: inst.instructor.id };
  const staff = await staffFromToken(readCookie(req, STAFF_COOKIE));
  if (staff) {
    if (!can(staff.role, "support")) throw new HttpError(403, "FORBIDDEN", "이 작업은 권한이 없어요.");
    return { kind: "staff", id: staff.id };
  }
  throw new HttpError(401, "LOGIN_REQUIRED", "강사나 직원으로 로그인해 주세요.");
}

export const POST = route<Ctx>(async (req, { params }) => {
  const who = await author(req);
  const { id } = await params;
  const input = await readJson(req, body);
  const a = await answerQuestion(who, id, input.body);
  return NextResponse.json({ answer: { id: a.id } }, { status: 201 });
});
