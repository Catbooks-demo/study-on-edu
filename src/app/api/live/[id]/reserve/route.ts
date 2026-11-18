import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { reserveSeat } from "@/server/live";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 라이브 자리 예약. 정원이 차면 409 LIVE_FULL. 이미 예약했으면 그 자리. */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const seat = await reserveSeat(user.id, id);
  return NextResponse.json({ seat: { id: seat.id, reserved_at: seat.reserved_at.toISOString(), entered_at: seat.entered_at?.toISOString() ?? null } });
}, { feature: "write" });
