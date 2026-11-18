export const dynamic = "force-dynamic";

/** 앱이 살아 있는지. DB는 보지 않는다. */
export function GET() {
  return Response.json({ status: "ok" });
}
