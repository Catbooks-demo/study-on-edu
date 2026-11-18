import { NextResponse } from "next/server";
import { requireStaff } from "@/server/auth/session";
import { route } from "@/server/http";
import { db } from "@/server/db";
import { createEndpoint, endpointView } from "@/server/webhooks";

export const dynamic = "force-dynamic";

/** 웹훅 주소 목록 (secret은 앞 10자만). admin만. */
export const GET = route(async (req) => {
  await requireStaff(req, "api_keys");
  const list = await db.webhookEndpoint.findMany({ orderBy: { created_at: "asc" } });
  return NextResponse.json({ endpoints: list.map(endpointView) });
});

/** 웹훅 주소 등록. secret 원문은 이 응답에서 한 번만. admin만. */
export const POST = route(async (req) => {
  const staff = await requireStaff(req, "api_keys");
  const body = (await req.json().catch(() => null)) ?? {};
  const { endpoint, secret } = await createEndpoint(`staff:${staff.id}`, { url: body.url, events: body.events });
  return NextResponse.json({ endpoint: endpointView(endpoint), secret }, { status: 201 });
});
