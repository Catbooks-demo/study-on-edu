import { NextResponse } from "next/server";
import { apiActor, authApiKey } from "@/server/apikeys";
import { route } from "@/server/http";
import { updateIncident } from "@/server/status";
import { incidentV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 장애 공지 상태·안내 문구 바꾸기 (write). resolved면 끝난 시각을 남긴다. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const key = await authApiKey(req, "write");
  const { id } = await params;
  const body = await req.json().catch(() => null);
  return NextResponse.json({ incident: incidentV1(await updateIncident(apiActor(key), id, body ?? {})) });
});
