import { authApiKey } from "@/server/apikeys";
import { route } from "@/server/http";
import { renderMetrics } from "@/server/metrics";

export const dynamic = "force-dynamic";

/** Prometheus 지표. `metrics` 범위 API 키가 필요하다 (Authorization: Bearer sok_…). */
export const GET = route(
  async (req) => {
    await authApiKey(req, "metrics");
    return new Response(await renderMetrics(new Date()), {
      headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" },
    });
  },
  { group: "/metrics" },
);
