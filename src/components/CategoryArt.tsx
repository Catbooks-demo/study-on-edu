/**
 * 분야별 생성 그림 7종 (인라인 SVG, 외부 이미지 없음). 170×170 상자 안에 그린다.
 * variant(0..3)마다 요소 크기·개수가 조금씩 달라진다.
 */
type P = { ink: string; accent: string };

function Dev({ p, v }: { p: P; v: number }) {
  const widths = [[70, 96, 54, 82, 40], [88, 52, 100, 64, 76], [60, 84, 92, 46, 70], [96, 66, 50, 88, 58]][v];
  return (
    <g>
      <rect x="8" y="22" width="154" height="122" rx="14" fill={p.ink} opacity="0.14" />
      <rect x="8" y="22" width="154" height="122" rx="14" fill="none" stroke={p.ink} strokeWidth="3" />
      {[0, 1, 2].map((i) => <circle key={i} cx={24 + i * 13} cy="38" r="4" fill={p.ink} opacity={0.75 - i * 0.2} />)}
      {widths.map((w, i) => (
        <rect key={i} x={i % 2 ? 40 : 26} y={56 + i * 16} width={w} height="7" rx="3.5" fill={i === v + 1 ? p.accent : p.ink} opacity={i === v + 1 ? 1 : 0.7} />
      ))}
      <rect x={26 + widths[4] + 6} y="118" width="8" height="12" fill={p.accent} />
      <path d="M128 4 L112 14 L128 24 M146 4 L162 14 L146 24" fill="none" stroke={p.accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function Data({ p, v }: { p: P; v: number }) {
  const bars = [[40, 70, 52, 96], [60, 44, 88, 72], [30, 58, 80, 104], [76, 50, 64, 90]][v];
  const line = bars.map((b, i) => `${30 + i * 34},${128 - b - 18}`).join(" ");
  return (
    <g>
      {Array.from({ length: 5 }, (_, r) => Array.from({ length: 6 }, (_, c) => <circle key={`${r}${c}`} cx={14 + c * 28} cy={20 + r * 26} r="1.8" fill={p.ink} opacity="0.35" />))}
      {bars.map((b, i) => <rect key={i} x={18 + i * 34} y={140 - b} width="24" height={b} rx="5" fill={p.ink} opacity={0.55 + i * 0.12} />)}
      <polyline points={line} fill="none" stroke={p.accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {bars.map((b, i) => <circle key={i} cx={30 + i * 34} cy={128 - b - 18} r="5" fill={p.accent} stroke={p.ink} strokeWidth="2" />)}
      <path d="M8 146 H164" stroke={p.ink} strokeWidth="3" strokeLinecap="round" />
    </g>
  );
}

function Cert({ p, v }: { p: P; v: number }) {
  return (
    <g>
      <rect x="34" y="18" width="110" height="136" rx="10" fill={p.ink} opacity="0.12" transform={`rotate(${6 + v * 2} 89 86)`} />
      <rect x="22" y="14" width="110" height="136" rx="10" fill="#FFFFFF" opacity="0.92" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="38" y={34 + i * 26} width="12" height="12" rx="3" fill="none" stroke={p.ink} strokeWidth="2.5" />
          {i <= v && <path d={`M40 ${40 + i * 26} l4 4 l9 -10`} fill="none" stroke={p.accent} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
          <rect x="58" y={36 + i * 26} width={58 - (i % 2) * 18} height="7" rx="3.5" fill={p.ink} opacity="0.5" />
        </g>
      ))}
      <circle cx="134" cy="128" r="24" fill={p.accent} />
      <circle cx="134" cy="128" r="15" fill="none" stroke="#FFFFFF" strokeWidth="3" />
      <path d="M122 148 L116 168 L128 162 L134 172 L138 150" fill={p.accent} />
    </g>
  );
}

function Lang({ p, v }: { p: P; v: number }) {
  const glyphs = [["가", "A"], ["あ", "가"], ["A", "中"], ["가", "あ"]][v];
  return (
    <g>
      <path d="M14 26 H112 a14 14 0 0 1 14 14 V90 a14 14 0 0 1 -14 14 H54 L30 124 V104 H14 a14 14 0 0 1 -14 -14 V40 a14 14 0 0 1 14 -14 Z" fill={p.ink} opacity="0.9" />
      <text x="62" y="82" textAnchor="middle" fontSize="44" fontWeight="800" fill={p.accent}>{glyphs[0]}</text>
      <path d="M82 76 H156 a12 12 0 0 1 12 12 V130 a12 12 0 0 1 -12 12 H146 V160 L126 142 H82 a12 12 0 0 1 -12 -12 V88 a12 12 0 0 1 12 -12 Z" fill={p.accent} />
      <text x="119" y="124" textAnchor="middle" fontSize="36" fontWeight="800" fill="#10213D">{glyphs[1]}</text>
      {[0, 1, 2].map((i) => <circle key={i} cx={140 + i * 10} cy="20" r="3.5" fill={p.ink} opacity={0.4 + i * 0.25} />)}
    </g>
  );
}

function Dsgn({ p, v }: { p: P; v: number }) {
  const c = [[20, 130, 60, 10, 150, 60], [20, 100, 80, 160, 150, 40], [20, 60, 70, 150, 150, 110], [20, 140, 100, 20, 150, 120]][v];
  return (
    <g>
      <path d={`M${c[0]} ${c[1]} Q ${c[2]} ${c[3]} ${c[4] / 2 + 10} ${(c[1] + c[5]) / 2} T ${c[4]} ${c[5]}`} fill="none" stroke={p.ink} strokeWidth="4" strokeLinecap="round" />
      <path d={`M${c[2] - 24} ${c[3] + 10} L${c[2] + 24} ${c[3] - 10}`} stroke={p.ink} strokeWidth="2" opacity="0.7" />
      <circle cx={c[2] - 24} cy={c[3] + 10} r="5" fill={p.ink} />
      <circle cx={c[2] + 24} cy={c[3] - 10} r="5" fill={p.ink} />
      {[[c[0], c[1]], [c[4], c[5]]].map(([x, y], i) => <rect key={i} x={x - 7} y={y - 7} width="14" height="14" fill="#FFFFFF" stroke={p.ink} strokeWidth="3" />)}
      {[0, 1, 2].map((i) => <circle key={i} cx={30 + i * 26} cy="158" r="10" fill={i === 1 ? p.accent : p.ink} opacity={i === 1 ? 1 : 0.5 + i * 0.2} />)}
      <path d="M132 14 L150 32 L128 70 L116 58 Z" fill={p.accent} />
      <circle cx="128" cy="44" r="4" fill="#10213D" />
    </g>
  );
}

function Biz({ p, v }: { p: P; v: number }) {
  const steps = [[30, 50, 74, 104], [40, 36, 70, 110], [24, 60, 64, 96], [44, 58, 82, 116]][v];
  return (
    <g>
      {steps.map((h, i) => <rect key={i} x={12 + i * 30} y={150 - h} width="24" height={h} rx="4" fill={p.ink} opacity={0.5 + i * 0.15} />)}
      <path d={`M14 ${118 - steps[0]} L44 ${108 - steps[1]} L74 ${112 - steps[2]} L116 ${80 - steps[3] / 2}`} fill="none" stroke={p.accent} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={`M100 ${78 - steps[3] / 2} L118 ${78 - steps[3] / 2} L118 ${96 - steps[3] / 2}`} fill="none" stroke={p.accent} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" transform={`rotate(-12 118 ${80 - steps[3] / 2})`} />
      <circle cx="146" cy="120" r="22" fill="#FFFFFF" opacity="0.9" />
      <path d={`M146 120 L146 98 A22 22 0 0 1 ${146 + 22 * Math.sin(1.2 + v * 0.4)} ${120 - 22 * Math.cos(1.2 + v * 0.4)} Z`} fill={p.accent} />
    </g>
  );
}

function Exam({ p, v }: { p: P; v: number }) {
  const f = ["x²+y²=r²", "∫f(x)dx", "aₙ=a₁+(n-1)d", "P(A|B)"][v];
  return (
    <g>
      <rect x="14" y="16" width="120" height="146" rx="8" fill="#FFFFFF" opacity="0.94" />
      {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M26 ${48 + i * 18} H122`} stroke={p.ink === "#FFFFFF" ? "#BFDBFE" : p.ink} strokeWidth="1.5" opacity="0.6" />)}
      <path d="M36 16 V162" stroke="#FF8A7A" strokeWidth="1.5" opacity="0.7" />
      <text x="44" y="62" fontSize="16" fontWeight="700" fill="#10213D">{f}</text>
      <path d="M46 92 q14 -12 30 0 t30 0" fill="none" stroke={p.accent} strokeWidth="3" strokeLinecap="round" />
      <g transform="rotate(38 140 90)">
        <rect x="132" y="30" width="16" height="104" rx="3" fill={p.accent} />
        <path d="M132 134 L140 152 L148 134 Z" fill="#FAD96A" />
        <path d="M137 145 L140 152 L143 145 Z" fill="#10213D" />
      </g>
    </g>
  );
}

const ART: Record<string, (props: { p: P; v: number }) => React.JSX.Element> = {
  DEV: Dev,
  DATA: Data,
  CERT: Cert,
  LANG: Lang,
  DSGN: Dsgn,
  BIZ: Biz,
  EXAM: Exam,
};

export function CategoryArt({ category, ink, accent, variant = 0 }: { category: string; ink: string; accent: string; variant?: number }) {
  const Art = ART[category] ?? Dev;
  return <Art p={{ ink, accent }} v={variant % 4} />;
}
