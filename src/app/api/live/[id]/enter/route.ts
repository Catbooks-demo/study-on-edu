import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { enterLive } from "@/server/live";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 라이브 입장 (시작 10분 전부터). 방 주소를 돌려준다. */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  return NextResponse.json(await enterLive(user.id, id));
}, { feature: "play" });
