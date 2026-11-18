import { NextResponse } from "next/server";
import { requireInstructor } from "@/server/auth/session";
import { publicInstructor } from "@/server/auth/users";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  return NextResponse.json(publicInstructor(await requireInstructor(req)));
});
