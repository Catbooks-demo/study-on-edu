/**
 * 강의 썸네일: 분야별 그라데이션 + 도형 (외부 이미지 없음). 같은 강의 코드면 늘 같은 모양.
 */
const PALETTE: Record<string, { from: string; to: string; ink: string }> = {
  DEV: { from: "#5B3DF5", to: "#9C8BFF", ink: "#FFFFFF" },
  DATA: { from: "#0F9F94", to: "#6FE3D2", ink: "#FFFFFF" },
  CERT: { from: "#F5C518", to: "#FF9F43", ink: "#1B1A2E" },
  LANG: { from: "#F2546B", to: "#FFB0A0", ink: "#FFFFFF" },
  DSGN: { from: "#B53CD8", to: "#F6A6E8", ink: "#FFFFFF" },
  BIZ: { from: "#139A62", to: "#9BE6B4", ink: "#FFFFFF" },
  EXAM: { from: "#24206B", to: "#6A55F7", ink: "#FFFFFF" },
};

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function Motif({ cat, ink, r }: { cat: string; ink: string; r: (n: number) => number }) {
  const o = { fill: "none", stroke: ink, strokeWidth: 6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (cat) {
    case "DEV":
      return (
        <g {...o}>
          <path d="M70 60 L40 90 L70 120" />
          <path d="M150 60 L180 90 L150 120" />
          <path d="M122 50 L98 130" />
        </g>
      );
    case "DATA":
      return (
        <g fill={ink}>
          {[0, 1, 2, 3].map((i) => {
            const h = 30 + ((r(i) % 60) | 0);
            return <rect key={i} x={50 + i * 34} y={135 - h} width={22} height={h} rx={5} opacity={0.6 + i * 0.1} />;
          })}
          <path d="M45 140 H190" stroke={ink} strokeWidth={5} strokeLinecap="round" />
        </g>
      );
    case "CERT":
      return (
        <g {...o}>
          <circle cx="110" cy="85" r="42" />
          <path d="M90 86 L105 101 L132 72" />
          <path d="M88 124 L80 150 L98 142 L110 156 L122 142 L140 150 L132 124" strokeWidth={5} />
        </g>
      );
    case "LANG":
      return (
        <g {...o}>
          <path d="M45 55 H135 a12 12 0 0 1 12 12 V100 a12 12 0 0 1 -12 12 H80 L60 130 V112 H45 a12 12 0 0 1 -12 -12 V67 a12 12 0 0 1 12 -12 Z" />
          <path d="M160 80 H185 a10 10 0 0 1 10 10 V118 a10 10 0 0 1 -10 10 H178 V142 L162 128 H120" strokeWidth={5} />
        </g>
      );
    case "DSGN":
      return (
        <g>
          <circle cx="85" cy="85" r="38" fill={ink} opacity={0.85} />
          <rect x="105" y="70" width="70" height="70" rx="14" fill="none" stroke={ink} strokeWidth={6} />
          <path d="M60 150 L150 150" stroke={ink} strokeWidth={6} strokeLinecap="round" opacity={0.7} />
        </g>
      );
    case "BIZ":
      return (
        <g {...o}>
          <path d={`M40 140 L80 ${110 - (r(1) % 20)} L115 ${120 - (r(2) % 20)} L150 80 L185 50`} />
          <path d="M160 48 H186 V74" />
          <path d="M40 150 H190" strokeWidth={4} opacity={0.6} />
        </g>
      );
    default:
      return (
        <g {...o}>
          <path d="M60 140 L150 50 L170 70 L80 160 L52 168 Z" />
          <path d="M140 60 L160 80" />
          <path d="M40 60 H90 M40 80 H75" strokeWidth={5} opacity={0.7} />
        </g>
      );
  }
}

export function CourseThumb({ code, category, className = "" }: { code: string; category: string; className?: string }) {
  const p = PALETTE[category] ?? PALETTE.DEV;
  const seed = seedOf(code);
  const r = (n: number) => (seedOf(`${code}:${n}`) % 1000) / 10;
  const id = `g-${code.replace(/[^A-Za-z0-9]/g, "")}`;
  const angle = seed % 360;
  const bx = 220 + (seed % 60);
  const by = 20 + ((seed >> 8) % 60);
  return (
    <svg viewBox="0 0 320 180" className={className} role="img" aria-label="강의 썸네일" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={id} gradientTransform={`rotate(${angle % 90 + 20})`}>
          <stop offset="0" stopColor={p.from} />
          <stop offset="1" stopColor={p.to} />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#${id})`} />
      <circle cx={bx} cy={by} r={60 + (seed % 30)} fill="#FFFFFF" opacity="0.14" />
      <circle cx={40 + ((seed >> 4) % 40)} cy={170} r={45} fill="#FFFFFF" opacity="0.1" />
      <rect x={250 - ((seed >> 12) % 30)} y={110} width="44" height="44" rx="10" fill="#F5C518" opacity={category === "CERT" ? 0.35 : 0.85} transform={`rotate(${(seed >> 3) % 30} 270 130)`} />
      <g transform="translate(20 0)">
        <Motif cat={category} ink={p.ink} r={r} />
      </g>
    </svg>
  );
}
