import type { Metadata } from "next";
import { QueueForm } from "@/components/ops/QueueForm";
import { listQueues } from "@/server/queue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "대기열" };

/** 대기열 (가상 대기실): 대상별 켜기·한도·대기 인원·평균 대기·최근 1분 입장. */
export default async function QueuePage() {
  const queues = await listQueues(new Date());
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">대기열</h1>
        <p className="mt-1 text-sm text-slate-600">
          사이트·결제 캠페인 대기열은 기본으로 꺼져 있어요. 접속이 몰리면 켜고 초당 입장 수를 정해요 (기본: 사이트 50, 결제 10, 라이브 20).
          라이브 대기열은 시작 10분 전부터 끝날 때까지 자동으로 켜져요. 입장 허용은 10분, 60초 동안 새로고침이 없는 순번표는 만료돼요.
        </p>
      </div>
      <ul className="space-y-3">
        {queues.map((q) => (
          <li key={q.target} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200" data-testid="queue-row">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono font-semibold">{q.target}</p>
              <span className={`badge ${q.enabled ? "bg-emerald-100 text-emerald-800" : ""}`}>{q.enabled ? "켜짐" : "꺼짐"}</span>
              <p className="text-sm text-slate-600">
                대기 {q.waiting.toLocaleString("ko-KR")}명 · 평균 대기 {q.avg_wait_sec}초 · 최근 1분 입장 {q.admitted_last_min.toLocaleString("ko-KR")}명
              </p>
            </div>
            <div className="mt-3">
              <QueueForm target={q.target} enabled={q.enabled} rate={q.rate_per_sec} courseCodes={q.course_codes} />
            </div>
          </li>
        ))}
        {queues.length === 0 && <li className="text-sm text-slate-500">아직 설정한 대기열이 없어요 (모두 꺼짐).</li>}
      </ul>
      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="mb-3 font-semibold">대기열 추가</h2>
        <QueueForm />
      </section>
    </div>
  );
}
