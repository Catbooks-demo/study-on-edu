import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { HttpError, readJson, route } from "@/server/http";
import { lectureAccess } from "@/server/player";
import { askQuestion, listQuestions, questionView } from "@/server/qa";

export const dynamic = "force-dynamic";

const body = z.object({
  lecture_id: z.string().min(1).max(40),
  title: z.string().trim().min(2, "제목을 두 글자 이상 적어 주세요.").max(100, "제목은 100자까지 적을 수 있어요."),
  body: z.string().trim().min(5, "질문을 다섯 글자 이상 적어 주세요.").max(3000, "질문은 3,000자까지 적을 수 있어요."),
});

/** 질문 목록: ?lecture_id= 그 강의 질문(수강권이 있어야), 없으면 내 질문. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const lectureId = new URL(req.url).searchParams.get("lecture_id");
  if (lectureId) {
    const acc = await lectureAccess(user.id, lectureId);
    if (!acc.enrollment) throw new HttpError(403, "NO_ACCESS", "수강권이 있어야 볼 수 있어요.");
    const qs = await listQuestions({ lectureId });
    return NextResponse.json({ questions: qs.map((q) => questionView(q, user.id)) });
  }
  const qs = await listQuestions({ userId: user.id });
  return NextResponse.json({ questions: qs.map((q) => questionView(q, user.id)) });
}, { feature: "browse" });

/** 질문 쓰기 (수강권 필요, 계정 10회/10분). */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await readJson(req, body);
  const q = await askQuestion(user.id, input);
  return NextResponse.json({ question: { id: q.id } }, { status: 201 });
}, { feature: "write" });
