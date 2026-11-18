import { NextResponse } from "next/server";
import { apiActor, authApiKey } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { createIncident } from "@/server/status";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";
import { incidentV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

/** 장애 공지 목록 (read). `?status=open`이면 해결 전 것만. */
export const GET = route(async (req) => {
  await authApiKey(req, "read");
  const p = readPage(req);
  const open = new URL(req.url).searchParams.get("status") === "open";
  const rows = await db.incident.findMany({
    where: { ...pageWhere(p), ...(open ? { status: { not: "resolved" } } : {}) },
    orderBy: pageOrder,
    take: p.limit,
  });
  return NextResponse.json(pageResult(rows, p, incidentV1));
});

/** 장애 공지 쓰기 (write). 상태 페이지·사이트 배너에 바로 나오고 웹훅 incident.created가 나간다. */
export const POST = route(async (req) => {
  const key = await authApiKey(req, "write");
  const body = await req.json().catch(() => null);
  const inc = await createIncident(apiActor(key), body ?? {});
  return NextResponse.json({ incident: incidentV1(inc) }, { status: 201 });
});
