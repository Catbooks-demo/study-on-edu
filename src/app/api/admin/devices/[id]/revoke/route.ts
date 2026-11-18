import { NextResponse } from "next/server";
import { requireStaff } from "@/server/auth/session";
import { deviceView, revokeDevice } from "@/server/devices";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 수강생 기기 해제 (권한 students). 감사 기록을 남긴다. */
export const POST = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "students");
  const { id } = await params;
  const d = await revokeDevice({ kind: "staff", id: staff.id }, id);
  return NextResponse.json({ device: deviceView(d) });
});
