import type { Metadata } from "next";
import { NewWebhookForm, WebhookActions } from "@/components/ops/WebhookForms";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";
import { RETRY_MIN, endpointView, recentDeliveries } from "@/server/webhooks";
import { guard } from "../guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "웹훅" };

/** 웹훅 주소 관리와 최근 배달 (admin만). */
export default async function WebhooksPage() {
  await guard("api_keys");
  const [endpoints, deliveries] = await Promise.all([
    db.webhookEndpoint.findMany({ orderBy: { created_at: "asc" } }).then((l) => l.map(endpointView)),
    recentDeliveries(30),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold">웹훅</h1>
      <p className="mt-1 text-sm text-slate-600">
        이벤트가 생기면 등록한 주소로 POST해요. 헤더 X-StudyOn-Signature = t=&lt;unix초&gt;,v1=HMAC-SHA256(비밀값, &quot;t.본문&quot;).
        실패하면 {RETRY_MIN.join("·")}분 뒤 다시 보내고 6번째 실패면 멈춰요.
      </p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="space-y-3">
          {endpoints.map((e) => (
            <div key={e.id} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200" data-testid="webhook-row">
              <p className="break-all font-mono text-sm font-semibold">{e.url}</p>
              <p className="mt-1 text-xs text-slate-500">
                {e.active ? "켜짐" : "꺼짐"} · 비밀값 {e.secret_prefix}… · {e.events.join(", ")}
              </p>
              <WebhookActions id={e.id} active={e.active} />
            </div>
          ))}
          {endpoints.length === 0 && <p className="text-sm text-slate-500">등록한 주소가 없어요.</p>}
          <h2 className="pt-4 font-semibold">최근 배달</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white text-sm ring-1 ring-slate-200">
            {deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap gap-x-3 px-4 py-2">
                <span className="font-mono">{d.type}</span>
                <span>{d.status}</span>
                <span className="text-slate-500">시도 {d.attempts} · HTTP {d.last_status ?? "-"}</span>
                <span className="text-slate-500">{dateTimeKo(d.created_at)}</span>
              </li>
            ))}
            {deliveries.length === 0 && <li className="px-4 py-2 text-slate-500">아직 보낸 것이 없어요.</li>}
          </ul>
        </section>
        <NewWebhookForm />
      </div>
    </div>
  );
}
