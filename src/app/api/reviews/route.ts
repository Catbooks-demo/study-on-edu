import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { writeReview } from "@/server/reviews";

export const dynamic = "force-dynamic";

const body = z.object({
  course_code: z.string().min(1).max(40),
  rating: z.number().int().min(1, "별점은 1~5점이에요.").max(5, "별점은 1~5점이에요."),
  body: z.string().trim().min(10, "후기를 열 글자 이상 적어 주세요.").max(1000, "후기는 1,000자까지 적을 수 있어요."),
});

/** 후기 쓰기: 진도율 40% 이상, 강의당 하나. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const { course_code, ...input } = await readJson(req, body);
  const r = await writeReview(user.id, course_code, input);
  return NextResponse.json({ review: { id: r.id, rating: r.rating } }, { status: 201 });
});
