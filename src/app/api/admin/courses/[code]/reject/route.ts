import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectCourse } from "@/server/admin";
import { requireStaff } from "@/server/auth/session";
import { readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

const body = z.object({ reason: z.string().max(1000, "사유는 1000자까지 적을 수 있어요.") });

/** 강의 심사 반려 (권한 review_courses). 사유가 비면 400. */
export const POST = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "review_courses");
  const { code } = await params;
  const { reason } = await readJson(req, body);
  const c = await rejectCourse(staff.id, code, reason);
  return NextResponse.json({ course: { code: c.code, status: c.status, reject_reason: c.reject_reason } });
});
