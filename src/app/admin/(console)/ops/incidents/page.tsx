import type { Metadata } from "next";
import { IncidentStatusForm, NewIncidentForm } from "@/components/ops/IncidentForms";
import { dateTimeKo } from "@/lib/format";
import { COMPONENT_LABEL, INCIDENT_STATUS_LABEL, incidentView, listIncidents } from "@/server/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "장애 공지" };

/** 장애 공지 쓰기·고치기. 열린 공지는 상태 페이지(/status)와 사이트 배너에 나온다. */
export default async function IncidentsPage() {
  const list = (await listIncidents(new Date(), { days: 30 })).map(incidentView);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section>
        <h1 className="text-2xl font-bold">장애 공지</h1>
        {list.length === 0 && <p className="mt-4 text-sm text-slate-500">최근 30일 장애 공지가 없어요.</p>}
        <ul className="mt-4 space-y-3">
          {list.map((i) => (
            <li key={i.id} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200" data-testid="incident-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${i.severity === "outage" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>
                  {i.severity === "outage" ? "장애" : "느림"}
                </span>
                <p className="font-semibold">{i.title}</p>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {INCIDENT_STATUS_LABEL[i.status as keyof typeof INCIDENT_STATUS_LABEL] ?? i.status} · {dateTimeKo(i.started_at)} ·{" "}
                {i.components.map((c) => COMPONENT_LABEL[c as keyof typeof COMPONENT_LABEL] ?? c).join(", ")}
              </p>
              <p className="mt-2 whitespace-pre-line text-sm">{i.body}</p>
              {i.status !== "resolved" && <IncidentStatusForm id={i.id} status={i.status} />}
            </li>
          ))}
        </ul>
      </section>
      <NewIncidentForm />
    </div>
  );
}
