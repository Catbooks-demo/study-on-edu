import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { answerInquiry, inquiryView } from "@/server/inquiries";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ answer: z.string().trim().min(1, "답변을 적어 주세요.").max(5000, "답변은 5000자까지 적을 수 있어요.") });

/** 1:1 문의 답변 (권한 support). 다시 답하면 답변을 바꾼다. */
export const POST = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "support");
  const { id } = await params;
  const { answer } = await readJson(req, body);
  const q = await answerInquiry(`staff:${staff.id}`, id, answer);
  return NextResponse.json({ inquiry: inquiryView(q) });
});
