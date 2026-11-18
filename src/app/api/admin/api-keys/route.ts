import { NextResponse } from "next/server";
import { z } from "zod";
import { SCOPES, type Scope, issueApiKey } from "@/server/apikeys";
import { audit } from "@/server/audit";
import { requireStaff } from "@/server/auth/session";
import { db } from "@/server/db";
import { readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

const body = z.object({
  name: z.string().trim().min(1, "키 이름을 적어 주세요.").max(50),
  scopes: z.array(z.enum(SCOPES as [Scope, ...Scope[]])).min(1, "범위를 하나 이상 골라 주세요."),
});

/** API 키 목록 (관리자만). 원문·해시는 내보내지 않는다. */
export const GET = route(async (req) => {
  await requireStaff(req, "api_keys");
  const keys = await db.apiKey.findMany({ orderBy: { created_at: "desc" } });
  return NextResponse.json({
    keys: keys.map((k) => ({
      id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes,
      last_used_at: k.last_used_at?.toISOString() ?? null, revoked_at: k.revoked_at?.toISOString() ?? null, created_at: k.created_at.toISOString(),
    })),
  });
});

/** API 키 발급 (관리자만). 원문은 이 응답에서 한 번만 보여 준다. */
export const POST = route(async (req) => {
  const staff = await requireStaff(req, "api_keys");
  const { name, scopes } = await readJson(req, body);
  const k = await issueApiKey(name, scopes, staff.id);
  await audit(`staff:${staff.id}`, "apikey.issue", `apikey:${k.id}`, { name, scopes });
  return NextResponse.json({ id: k.id, prefix: k.prefix, key: k.key }, { status: 201 });
});
