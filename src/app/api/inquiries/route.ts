import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { INQUIRY_CATEGORIES, createInquiry, inquiryView, listMyInquiries } from "@/server/inquiries";

export const dynamic = "force-dynamic";

const body = z.object({
  category: z.enum(INQUIRY_CATEGORIES, { message: "문의 종류를 골라 주세요." }),
  title: z.string().trim().min(2, "제목을 두 글자 이상 적어 주세요.").max(100, "제목은 100자까지 적을 수 있어요."),
  body: z.string().trim().min(10, "문의 내용을 열 글자 이상 적어 주세요.").max(3000, "문의는 3,000자까지 적을 수 있어요."),
});

/** 내 1:1 문의. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json({ inquiries: (await listMyInquiries(user.id)).map(inquiryView) });
}, { feature: "browse" });

/** 1:1 문의 쓰기 (계정 10회/10분). */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await readJson(req, body);
  const q = await createInquiry(user.id, input);
  return NextResponse.json({ inquiry: inquiryView(q) }, { status: 201 });
}, { feature: "write" });
