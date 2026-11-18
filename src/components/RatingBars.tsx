import { Stars } from "./Stars";

/** 별점 분포 막대. dist = [1점 수 … 5점 수]. */
export function RatingBars({ avg, dist }: { avg: number; dist: number[] }) {
  const total = dist.reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
      <div className="text-center sm:w-36">
        <p className="text-4xl font-extrabold tabular-nums">{total ? avg.toFixed(1) : "-"}</p>
        <Stars value={avg} />
        <p className="mt-1 text-xs text-slate-500">수강평 {total.toLocaleString("ko-KR")}개</p>
      </div>
      <ul className="flex-1 space-y-1.5" aria-label="별점 분포">
        {[5, 4, 3, 2, 1].map((star) => {
          const n = dist[star - 1] ?? 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          return (
            <li key={star} className="flex items-center gap-3 text-sm">
              <span className="w-8 text-slate-600">{star}점</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full rounded-full bg-lemon-500" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-10 text-right tabular-nums text-slate-500">{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
