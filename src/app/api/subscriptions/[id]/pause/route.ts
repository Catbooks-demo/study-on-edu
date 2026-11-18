import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { pause, subscriptionView } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ days: z.number().int("일시정지 일수는 정수로 적어 주세요.") });

/** 일시정지 (active일 때만, 1~30일, 1년에 2번). */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const { days } = await readJson(req, body);
  const s = await pause(user.id, id, days);
  return NextResponse.json({ subscription: subscriptionView(s) });
}, { feature: "write" });
