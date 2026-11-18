import { NextResponse } from "next/server";
import { requireStaff } from "@/server/auth/session";
import { route } from "@/server/http";
import { incidentView, updateIncident } from "@/server/status";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 장애 공지 상태·안내 문구 바꾸기. admin만. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "ops");
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const inc = await updateIncident(`staff:${staff.id}`, id, body ?? {});
  return NextResponse.json({ incident: incidentView(inc) });
});
