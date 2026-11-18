import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { INTEREST_CODES, phoneSchema, publicUser } from "@/server/auth/users";
import { db } from "@/server/db";
import { readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** 바꿀 수 있는 항목만 (이메일·비밀번호는 여기서 바꾸지 않는다). 모르는 키는 버린다. */
const body = z.object({
  name: z.string().trim().min(1, "이름을 넣어 주세요.").max(30).optional(),
  phone: phoneSchema.optional(),
  birth_year: z.number().int().min(1900, "태어난 해를 확인해 주세요.").max(2100, "태어난 해를 확인해 주세요.").nullable().optional(),
  interests: z.array(z.enum(INTEREST_CODES)).max(7).optional(),
  marketing_opt_in: z.boolean().optional(),
});

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json({ user: publicUser(user) });
}, { feature: "browse" });

/** 회원 정보 고치기. */
export const PATCH = route(async (req) => {
  const user = await requireUser(req);
  const input = await readJson(req, body);
  const u = await db.user.update({ where: { id: user.id }, data: input });
  return NextResponse.json({ user: publicUser(u) });
}, { feature: "write" });
