import { NextResponse } from "next/server";
import { userFromRequest } from "@/server/auth/session";
import { route } from "@/server/http";
import { playerInfo } from "@/server/player";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 재생 정보 (강·스크립트·커리큘럼·진도·이어보기). 미리보기 강은 로그인 없이도 된다. */
export const GET = route<Ctx>(async (req, { params }) => {
  const user = await userFromRequest(req);
  const { id } = await params;
  return NextResponse.json(await playerInfo(user?.id ?? null, id));
});
