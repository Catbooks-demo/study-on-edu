import { NextResponse } from "next/server";
import { revokeApiKey } from "@/server/apikeys";
import { audit } from "@/server/audit";
import { requireStaff } from "@/server/auth/session";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** API 키 폐기 (관리자만). */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "api_keys");
  const { id } = await params;
  const k = await revokeApiKey(id);
  await audit(`staff:${staff.id}`, "apikey.revoke", `apikey:${id}`);
  return NextResponse.json({ id: k.id, revoked_at: k.revoked_at?.toISOString() ?? null });
});
