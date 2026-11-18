import { NextResponse } from "next/server";
import { requireStaff } from "@/server/auth/session";
import { route } from "@/server/http";
import { sendTest } from "@/server/webhooks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 시험 보내기 (ping 이벤트를 바로 한 번). admin만. */
export const POST = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "api_keys");
  const { id } = await params;
  return NextResponse.json(await sendTest(`staff:${staff.id}`, id));
});
