/** 스터디온에듀 글자 로고: 켜진 스위치(ON) 모양 위에 이름. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 36 22" className="h-6 w-9" aria-hidden="true">
        <rect x="1" y="1" width="34" height="20" rx="10" fill="#5B3DF5" />
        <circle cx="25" cy="11" r="7" fill="#F5C518" />
      </svg>
      <span className="text-xl font-extrabold tracking-tight text-brand-700">스터디온에듀</span>
    </span>
  );
}
