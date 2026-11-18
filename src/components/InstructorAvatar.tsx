import { avatarSpec } from "@/lib/art/avatar";
import { DemoBadge } from "./DemoBadge";

/** 가상 강사 추상 아바타 (slug로 정해진 도형, 사람 얼굴·사진이 아니다). */
export function InstructorAvatar({
  slug,
  name,
  size = 56,
  withBadge = false,
  className = "",
}: {
  slug: string;
  name: string;
  size?: number;
  withBadge?: boolean;
  className?: string;
}) {
  const a = avatarSpec(slug);
  const art = (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`shrink-0 rounded-full ${withBadge ? "" : className}`}
      role="img"
      aria-label={`${name} 아바타, 시연용 가상 강사`}
      data-avatar={slug}
    >
      <defs>
        <clipPath id={`av-${slug}`}><circle cx="50" cy="50" r="50" /></clipPath>
      </defs>
      <g clipPath={`url(#av-${slug})`}>
        <rect width="100" height="100" fill={a.bg} />
        <g transform={`rotate(${a.rotate} 50 50)`}>
          {a.shape === "orbit" && (
            <>
              <circle cx="50" cy="50" r="30" fill="none" stroke={a.fg} strokeWidth="9" />
              <circle cx="80" cy="50" r="10" fill={a.accent} />
            </>
          )}
          {a.shape === "split" && (
            <>
              <path d="M0 0 H100 V48 H0 Z" fill={a.fg} />
              <circle cx="50" cy="60" r="20" fill={a.accent} />
            </>
          )}
          {a.shape === "stack" && (
            <>
              <rect x="14" y="22" width="72" height="16" rx="8" fill={a.fg} />
              <rect x="22" y="44" width="56" height="16" rx="8" fill={a.accent} />
              <rect x="30" y="66" width="40" height="16" rx="8" fill={a.fg} opacity="0.7" />
            </>
          )}
          {a.shape === "petal" && (
            <>
              <path d="M50 10 C78 10 90 40 50 50 C10 40 22 10 50 10 Z" fill={a.fg} />
              <path d="M50 90 C22 90 10 60 50 50 C90 60 78 90 50 90 Z" fill={a.accent} />
            </>
          )}
        </g>
        <circle cx={a.dot[0]} cy={a.dot[1]} r="5" fill={a.accent} stroke={a.bg} strokeWidth="2" />
      </g>
    </svg>
  );
  if (!withBadge) return art;
  return (
    <span className={`inline-flex flex-col items-center gap-1.5 ${className}`}>
      {art}
      <DemoBadge className="text-[10px]" />
    </span>
  );
}
