import type { Metadata } from "next";
import { dateTimeKo } from "@/lib/format";
import {
  COMPONENT_LABEL,
  INCIDENT_STATUS_LABEL,
  STATUS_LABEL,
  type ComponentState,
  componentStatus,
  incidentView,
  listIncidents,
} from "@/server/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "서비스 상태" };

const DOT: Record<ComponentState, string> = {
  operational: "bg-emerald-500",
  degraded: "bg-amber-400",
  outage: "bg-rose-500",
};

/** 서비스 상태 (로그인 없이). 대기열·점검 중에도 열린다. */
export default async function StatusPage() {
  const now = new Date();
  const rows = await componentStatus(now);
  const incidents = await listIncidents(now).then((l) => l.map(incidentView)).catch(() => []);
  const worst: ComponentState = rows.some((r) => r.status === "outage")
    ? "outage"
    : rows.some((r) => r.status === "degraded")
      ? "degraded"
      : "operational";
  const open = incidents.filter((i) => i.status !== "resolved");
  const past = incidents.filter((i) => i.status === "resolved");
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-extrabold tracking-tight">서비스 상태</h1>
      <p className="mt-1 text-sm text-slate-500">{dateTimeKo(now.toISOString())} 기준</p>

      <p data-testid="status-summary" className="mt-6 flex items-center gap-2 rounded-2xl bg-white p-5 text-lg font-bold ring-1 ring-slate-200">
        <span className={`inline-block size-3 rounded-full ${DOT[worst]}`} aria-hidden />
        {worst === "operational" ? "모든 서비스가 정상이에요" : STATUS_LABEL[worst]}
      </p>

      <ul className="mt-6 divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200" aria-label="구성요소 상태">
        {rows.map((r) => (
          <li key={r.component} data-testid="status-row" className="flex items-center justify-between px-5 py-3.5">
            <span className="font-medium">{COMPONENT_LABEL[r.component]}</span>
            <span className="flex items-center gap-2 text-sm">
              <span className={`inline-block size-2.5 rounded-full ${DOT[r.status]}`} aria-hidden />
              {STATUS_LABEL[r.status]}
            </span>
          </li>
        ))}
      </ul>

      {open.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-bold">진행 중인 장애</h2>
          <ul className="mt-3 space-y-3">
            {open.map((i) => (
              <li key={i.id} className="rounded-2xl bg-white p-5 ring-1 ring-rose-200">
                <p className="font-semibold">{i.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {INCIDENT_STATUS_LABEL[i.status as keyof typeof INCIDENT_STATUS_LABEL] ?? i.status} · {dateTimeKo(i.started_at)}부터 ·{" "}
                  {i.components.map((c) => COMPONENT_LABEL[c as keyof typeof COMPONENT_LABEL] ?? c).join(", ")}
                </p>
                <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{i.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-bold">최근 7일</h2>
        {past.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">지난 7일 동안 해결된 장애가 없어요.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {past.map((i) => (
              <li key={i.id} className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
                <span className="font-medium">{i.title}</span>
                <span className="text-slate-500"> · {dateTimeKo(i.started_at)} ~ {i.resolved_at ? dateTimeKo(i.resolved_at) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
