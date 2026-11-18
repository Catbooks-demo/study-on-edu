import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { publicUser } from "@/server/auth/users";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json({ user: publicUser(user) });
});
