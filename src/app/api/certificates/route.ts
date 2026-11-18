import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { certificateView, issueCertificate } from "@/server/certificates";
import { db } from "@/server/db";
import { HttpError, readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

const body = z.object({ course_code: z.string().min(1).max(40) });

/** 수료증 발급 (진도율 80% 이상). 이미 있으면 같은 수료증. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const { course_code } = await readJson(req, body);
  const course = await db.course.findUnique({ where: { code: course_code }, select: { id: true } });
  if (!course) throw new HttpError(404, "NOT_FOUND", "강의를 찾지 못했어요.");
  const c = await issueCertificate(user.id, course.id);
  return NextResponse.json({ certificate: certificateView(c) }, { status: 201 });
}, { feature: "play" });
