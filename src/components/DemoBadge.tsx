/** 강사가 보이는 곳마다 단다. 강사는 모두 가상 인물이다. */
export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`badge whitespace-nowrap bg-lemon-300/25 font-semibold text-lemon-600 ring-lemon-500/50 ${className}`}>
      시연용 가상 강사
    </span>
  );
}
