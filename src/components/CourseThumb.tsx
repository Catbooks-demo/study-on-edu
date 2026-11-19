import { CATEGORY_PALETTES, thumbSpec, wrapTitle } from "@/lib/art/thumb";
import { CategoryArt } from "./CategoryArt";

/** 배치 3에 깔리는 분야 글자. */
const GLYPH: Record<string, string> = { DEV: "{}", DATA: "∑", CERT: "A+", LANG: "Aa", DSGN: "✎", BIZ: "%", EXAM: "π" };

/** 그림이 놓일 자리: 배치(variant)마다 다르다. */
const PLACE = [
  { x: 150, y: 8, s: 1 },
  { x: 168, y: 22, s: 0.86 },
  { x: 140, y: 2, s: 1.02 },
  { x: 160, y: 14, s: 0.94 },
];

/**
 * 강의 썸네일: 분야 그림 + 제목 글자 + 배지(시간·난이도). 외부 이미지 없음.
 * 같은 강의 코드면 늘 같은 그림이고, 이웃한 강의 코드는 배치가 다르다.
 * title을 주지 않으면 그림만 크게 그린다(분야 타일·작은 썸네일).
 */
export function CourseThumb({
  code,
  category,
  title,
  badge,
  className = "",
}: {
  code: string;
  category: string;
  title?: string;
  badge?: string;
  className?: string;
}) {
  const spec = thumbSpec(code);
  const p = (CATEGORY_PALETTES[category] ?? CATEGORY_PALETTES.DEV)[spec.palette];
  const id = `t-${code.replace(/[^A-Za-z0-9]/g, "")}`;
  const lines = title ? wrapTitle(title, 7, 2) : [];
  const place = title ? PLACE[spec.variant] : { x: 75, y: 5, s: 1 };
  const mirror = spec.mirror && !title;
  return (
    <svg viewBox="0 0 320 180" className={className} role="img" aria-label={title ? `${title} 썸네일` : "분야 그림"} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`${id}-g`} gradientTransform={`rotate(${spec.angle})`}>
          <stop offset="0" stopColor={p.from} />
          <stop offset="1" stopColor={p.to} />
        </linearGradient>
        <pattern id={`${id}-p`} width="16" height="16" patternUnits="userSpaceOnUse">
          {spec.pattern === "dots" && <circle cx="3" cy="3" r="1.4" fill={p.ink} opacity="0.18" />}
          {spec.pattern === "grid" && <path d="M16 0 V16 M0 16 H16" stroke={p.ink} strokeWidth="0.8" opacity="0.14" />}
          {spec.pattern === "stripes" && <path d="M-4 4 L4 -4 M0 16 L16 0 M12 20 L20 12" stroke={p.ink} strokeWidth="2" opacity="0.1" />}
        </pattern>
      </defs>
      <rect width="320" height="180" fill={`url(#${id}-g)`} />
      <rect width="320" height="180" fill={`url(#${id}-p)`} />
      {/* 배치마다 다른 바탕 장치: 이웃한 카드가 한눈에 달라 보이게 */}
      {title && spec.variant === 1 && <circle cx={spec.mirror ? 300 : 40} cy="170" r="70" fill="none" stroke={p.accent} strokeWidth="14" opacity="0.35" />}
      {title && spec.variant === 2 && <path d="M-20 150 L340 40 L340 90 L-20 200 Z" fill={p.accent} opacity="0.22" />}
      {title && spec.variant === 3 && (
        <text x="300" y="176" textAnchor="end" fontSize="150" fontWeight="900" fill={p.ink} opacity="0.1">
          {GLYPH[category] ?? "?"}
        </text>
      )}
      <g transform={`translate(${place.x} ${place.y}) scale(${place.s})${mirror ? " translate(170 0) scale(-1 1)" : ""}`}>
        <CategoryArt category={category} ink={p.ink} accent={p.accent} variant={spec.variant} />
      </g>
      {lines.map((l, i) => (
        <text key={i} x="18" y={46 + i * 28} fontSize="23" fontWeight="800" letterSpacing="-0.5" fill={p.ink}>
          {l}
        </text>
      ))}
      {badge && (
        <g>
          <rect x="16" y="140" width={18 + [...badge].length * 11} height="24" rx="12" fill={p.ink === "#FFFFFF" ? "#10213D" : "#FFFFFF"} opacity="0.85" />
          <text x="25" y="157" fontSize="13" fontWeight="700" fill={p.ink === "#FFFFFF" ? "#FFFFFF" : "#10213D"}>
            {badge}
          </text>
        </g>
      )}
    </svg>
  );
}
