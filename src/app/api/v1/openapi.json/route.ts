import { NextResponse } from "next/server";
import { OPENAPI } from "@/server/v1/openapi";

export const dynamic = "force-static";

/** 외부 시스템 API 설명 (OpenAPI 3.1). 키 없이 볼 수 있다. */
export function GET() {
  return NextResponse.json(OPENAPI);
}
