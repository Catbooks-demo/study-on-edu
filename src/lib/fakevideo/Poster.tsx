import { H, W, type Op } from "./frame";

const anchor = { left: "start", center: "middle", right: "end" } as const;

/** display list를 SVG로 (서버에서도 그려진다). 움직임 줄이기 설정과 첫 화면에 쓴다. */
export function Poster({ ops, label, className = "", testId = "preview-poster" }: { ops: Op[]; label: string; className?: string; testId?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={label} data-testid={testId}>
      {ops.map((o, i) => {
        const opacity = o.opacity ?? 1;
        if (o.op === "rect") return <rect key={i} x={o.x} y={o.y} width={o.w} height={o.h} rx={o.r} fill={o.fill} opacity={opacity} />;
        if (o.op === "circle") return <circle key={i} cx={o.cx} cy={o.cy} r={o.r} fill={o.fill} opacity={opacity} />;
        if (o.op === "text")
          return (
            <text
              key={i}
              x={o.x}
              y={o.y}
              fontSize={o.size}
              fontWeight={o.weight ?? 400}
              fill={o.color}
              opacity={opacity}
              textAnchor={anchor[o.align ?? "left"]}
              fontFamily={o.font === "mono" ? "Consolas, ui-monospace, monospace" : undefined}
              transform={o.rotate ? `rotate(${o.rotate} ${o.x} ${o.y})` : undefined}
            >
              {o.text}
            </text>
          );
        if (o.op === "run")
          return (
            <text key={i} x={o.x} y={o.y} fontSize={o.size} fontFamily="Consolas, ui-monospace, monospace" xmlSpace="preserve" style={{ whiteSpace: "pre" }}>
              {o.parts.map((p, j) => (
                <tspan key={j} fill={p.color}>{p.text}</tspan>
              ))}
              {o.cursor && <tspan fill={o.cursor}>▌</tspan>}
            </text>
          );
        if (o.op === "path" && o.points.length > 1)
          return (
            <polyline
              key={i}
              points={o.points.map((p) => p.join(",")).join(" ")}
              fill="none"
              stroke={o.stroke}
              strokeWidth={o.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={opacity}
            />
          );
        return null;
      })}
    </svg>
  );
}
