/** 별점 표시 (읽기 전용). */
export function Stars({ value, count, size = "sm" }: { value: number; count?: number; size?: "sm" | "md" }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const text = size === "md" ? "text-base" : "text-xs";
  return (
    <span className={`inline-flex items-center gap-1 ${text}`}>
      <span className="relative inline-block leading-none tracking-tight" aria-hidden="true">
        <span className="text-slate-300">★★★★★</span>
        <span className="absolute inset-0 overflow-hidden text-lemon-500" style={{ width: `${pct}%` }}>★★★★★</span>
      </span>
      <span className="sr-only">별점 5점 만점에 {value.toFixed(1)}점</span>
      <span className="font-semibold text-ink" aria-hidden="true">{value.toFixed(1)}</span>
      {count !== undefined && <span className="text-slate-500">({count.toLocaleString("ko-KR")})</span>}
    </span>
  );
}
