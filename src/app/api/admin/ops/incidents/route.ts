import { NextResponse } from "next/server";
import { requireStaff } from "@/server/auth/session";
import { route } from "@/server/http";
import { createIncident, incidentView, listIncidents } from "@/server/status";

export const dynamic = "force-dynamic";

/** 장애 공지 목록 (열린 것 + 최근 30일). admin만. */
export const GET = route(async (req) => {
  await requireStaff(req, "ops");
  const list = await listIncidents(new Date(), { days: 30 });
  return NextResponse.json({ incidents: list.map(incidentView) });
});

/** 장애 공지 쓰기. admin만. */
export const POST = route(async (req) => {
  const staff = await requireStaff(req, "ops");
  const body = await req.json().catch(() => null);
  const inc = await createIncident(`staff:${staff.id}`, body ?? {});
  return NextResponse.json({ incident: incidentView(inc) }, { status: 201 });
});
