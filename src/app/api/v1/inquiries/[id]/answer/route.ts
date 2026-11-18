import { z } from "zod";
import { authApiKey } from "@/server/apikeys";
import { readJson, route } from "@/server/http";
import { notYet } from "@/server/v1/todo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ answer: z.string().trim().min(1, "답변을 넣어 주세요.").max(5000) });

/**
 * 1:1 문의 답변 (write).
 * TODO(M4): Task 13 answerInquiry(actor `api:<키 이름>`, id, answer)가 dev에 머지되면 그것을 부른다
 * (답변 알림 메시지·감사 기록 inquiry.answer를 같이 남긴다). 그 전에는 501.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  await authApiKey(req, "write");
  await params;
  await readJson(req, body);
  notYet("문의 답변", "M4 질문·문의");
});
