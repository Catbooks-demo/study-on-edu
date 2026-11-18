import type { Metadata } from "next";
import { ModeForm } from "@/components/ops/ModeForm";
import { dateTimeKo } from "@/lib/format";
import { MODE_LABEL, SUGGEST, suggestMode } from "@/rules/servicemode";
import { db } from "@/server/db";
import { recentWindow } from "@/server/metrics";
import { currentMode } from "@/server/servicemode";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "서비스 모드" };

/** 단계별 서비스 모드: 지금 값, 최근 1분 지표로 낸 제안, 바꾸기, 바뀐 기록. */
export default async function ModePage() {
  const now = new Date();
  const [m, history] = await Promise.all([currentMode(), db.serviceMode.findMany({ orderBy: { created_at: "desc" }, take: 20 })]);
  const w = recentWindow(now);
  const suggestion = suggestMode(w);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">서비스 모드</h1>
        <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <p className="text-sm text-slate-500">지금 모드</p>
          <p className="mt-1 text-xl font-bold" data-testid="current-mode">{MODE_LABEL[m.mode]}</p>
          {m.at && <p className="mt-1 text-xs text-slate-500">{dateTimeKo(m.at)} · {m.changed_by} · {m.reason}</p>}
        </div>
        <div className="rounded-2xl bg-white p-5 text-sm ring-1 ring-slate-200">
          <p className="font-semibold">자동 제안</p>
          <p className="mt-1">
            최근 1분 오류율 {(w.error_rate * 100).toFixed(1)}% · p95 {w.p95_ms}ms →{" "}
            <strong>{suggestion ? MODE_LABEL[suggestion] : "바꿀 필요 없어요"}</strong>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            기준: 오류율 ≥ {SUGGEST.degraded.error_rate * 100}% 또는 p95 ≥ {SUGGEST.degraded.p95_ms}ms면 degraded,
            오류율 ≥ {SUGGEST.read_only.error_rate * 100}% 또는 p95 ≥ {SUGGEST.read_only.p95_ms}ms면 read_only. 제안만 하고 바꾸는 것은 사람(또는 API 키)이에요.
          </p>
        </div>
        <div>
          <h2 className="font-semibold">바뀐 기록</h2>
          <ul className="mt-2 divide-y divide-slate-100 rounded-2xl bg-white text-sm ring-1 ring-slate-200">
            {history.map((h) => (
              <li key={h.id} className="px-4 py-2.5">
                <span className="font-medium">{h.mode}</span> · {dateTimeKo(h.created_at.toISOString())} · {h.changed_by} · {h.reason}
              </li>
            ))}
            {history.length === 0 && <li className="px-4 py-2.5 text-slate-500">아직 바꾼 적이 없어요 (정상).</li>}
          </ul>
        </div>
      </section>
      <ModeForm current={m.mode} suggestion={suggestion} />
    </div>
  );
}
