import { NextResponse } from "next/server";
import { approveCourse } from "@/server/admin";
import { requireStaff } from "@/server/auth/session";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

/** 강의 심사 승인 (권한 review_courses): in_review → published. */
export const POST = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "review_courses");
  const { code } = await params;
  const c = await approveCourse(staff.id, code);
  return NextResponse.json({ course: { code: c.code, status: c.status, published_at: c.published_at?.toISOString() ?? null } });
});
