/** 운영 개요의 작은 그래프: 최근 60분 분당 요청 수(막대)와 5xx(빨강). 서버에서 그리는 SVG. */
export function OpsChart({ series }: { series: { at: string; requests: number; errors: number; p95_ms: number }[] }) {
  const W = 600;
  const H = 120;
  const max = Math.max(1, ...series.map((s) => s.requests));
  const bw = W / series.length;
  const total = series.reduce((a, s) => a + s.requests, 0);
  const errors = series.reduce((a, s) => a + s.errors, 0);
  return (
    <figure className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <figcaption className="mb-2 flex justify-between text-sm">
        <span className="font-semibold">최근 60분 요청</span>
        <span className="text-slate-500">합계 {total.toLocaleString("ko-KR")} · 5xx {errors.toLocaleString("ko-KR")}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" role="img" aria-label={`최근 60분 요청 ${total}건, 5xx ${errors}건`}>
        <line x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} stroke="#e2e8f0" />
        {series.map((s, i) => {
          const h = (s.requests / max) * (H - 4);
          const eh = (s.errors / max) * (H - 4);
          return (
            <g key={s.at}>
              <rect x={i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} fill="#5B3DF5" opacity={0.75}>
                <title>{`${s.at.slice(11, 16)} UTC · ${s.requests}건 · p95 ${s.p95_ms}ms`}</title>
              </rect>
              {eh > 0 && <rect x={i * bw + 1} y={H - eh} width={Math.max(1, bw - 2)} height={eh} fill="#e11d48" />}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
