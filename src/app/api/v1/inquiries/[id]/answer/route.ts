import { NextResponse } from "next/server";
import { z } from "zod";
import { apiActor, authApiKey } from "@/server/apikeys";
import { readJson, route } from "@/server/http";
import { answerInquiry } from "@/server/inquiries";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ answer: z.string().trim().min(1, "답변을 넣어 주세요.").max(5000) });

/** 1:1 문의 답변 (write, 다시 보내면 고친다). 수강생에게 답변 알림이 가고 감사 기록 inquiry.answer(api:<키 이름>)가 남는다. */
export const POST = route<Ctx>(async (req, { params }) => {
  const key = await authApiKey(req, "write");
  const { id } = await params;
  const { answer } = await readJson(req, body);
  await answerInquiry(apiActor(key), id, answer);
  return NextResponse.json({ ok: true });
});
