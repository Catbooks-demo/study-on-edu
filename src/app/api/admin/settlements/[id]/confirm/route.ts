import { NextResponse } from "next/server";
import { requireStaff } from "@/server/auth/session";
import { route } from "@/server/http";
import { confirmSettlement, settlementView } from "@/server/settlements";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 정산 확정 (관리자만). 확정한 정산은 다시 계산해도 바뀌지 않는다. */
export const POST = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "settlements");
  const { id } = await params;
  const s = await confirmSettlement(staff.id, id);
  return NextResponse.json({ settlement: settlementView(s) });
});
