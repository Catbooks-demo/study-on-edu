import { NextResponse } from "next/server";
import { requireStaff } from "@/server/auth/session";
import { publicStaff } from "@/server/auth/users";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const staff = await requireStaff(req);
  return NextResponse.json({ staff: publicStaff(staff) });
});
