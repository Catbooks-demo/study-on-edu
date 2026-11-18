import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { revokeDevice } from "@/server/devices";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 기기 해제 (본인 기기만). 그 기기의 재생도 멈춘다. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  await revokeDevice({ kind: "user", id: user.id }, id);
  return NextResponse.json({ ok: true });
});
