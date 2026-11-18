import type { Metadata } from "next";
import Link from "next/link";
import { OpsChart } from "@/components/ops/OpsChart";
import { recentSeries, recentWindow } from "@/server/metrics";
import { COMPONENT_LABEL, STATUS_LABEL, componentStatus } from "@/server/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "운영 개요" };

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

/** 운영 개요: 최근 1분 지표, 60분 그래프, 구성요소 상태. (이 앱 인스턴스 기준) */
export default async function OpsHome() {
  const now = new Date();
  const w = recentWindow(now);
  const rows = await componentStatus(now);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">운영 개요</h1>
      <dl className="grid grid-cols-3 gap-3">
        {[
          ["최근 1분 오류율(5xx)", pct(w.error_rate)],
          ["최근 1분 p95", `${w.p95_ms.toLocaleString("ko-KR")}ms`],
          ["초당 요청", String(w.rps)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <dt className="text-xs text-slate-500">{k}</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <OpsChart series={recentSeries(now)} />
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">구성요소 상태</h2>
          <Link href="/status" className="text-sm text-brand-600 hover:underline">상태 페이지 보기</Link>
        </div>
        <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-5">
          {rows.map((r) => (
            <li key={r.component} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="font-medium">{COMPONENT_LABEL[r.component]}</p>
              <p className="text-slate-600">{STATUS_LABEL[r.status]}</p>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-xs text-slate-400">지표는 이 앱 하나의 메모리 기준이에요. 전체 지표는 /metrics(지표 키)로 Prometheus에서 모아 보세요.</p>
    </div>
  );
}
