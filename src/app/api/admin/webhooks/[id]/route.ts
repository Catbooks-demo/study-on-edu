import { NextResponse } from "next/server";
import { requireStaff } from "@/server/auth/session";
import { route } from "@/server/http";
import { deleteEndpoint, endpointView, updateEndpoint } from "@/server/webhooks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 켜기·끄기, 이벤트 바꾸기. admin만. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "api_keys");
  const { id } = await params;
  const body = (await req.json().catch(() => null)) ?? {};
  return NextResponse.json({ endpoint: endpointView(await updateEndpoint(`staff:${staff.id}`, id, body)) });
});

/** 주소 지우기 (배달 기록도 같이). admin만. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "api_keys");
  const { id } = await params;
  await deleteEndpoint(`staff:${staff.id}`, id);
  return NextResponse.json({ ok: true });
});
