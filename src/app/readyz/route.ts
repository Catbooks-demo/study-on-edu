import { db } from "@/server/db";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

/** 요청을 받을 준비가 됐는지 (DB 연결 포함). */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ready" });
  } catch (e) {
    log.error("readyz: DB 연결 실패", { error: e instanceof Error ? e.message : String(e) });
    return Response.json({ status: "not_ready" }, { status: 503 });
  }
}
