/**
 * 가짜 영상 렌더러 (DOM·canvas를 모르는 순수 함수).
 * 클립(장면 목록)과 시각 t(초)를 받아 그릴 것 목록(display list)을 돌려준다.
 * 같은 목록을 canvas(paint.ts)와 SVG 포스터(Poster.tsx)가 그리므로, 움직임 줄이기 설정에서도 같은 화면이 나온다.
 * 플레이어(Task 12)도 이 렌더러를 쓴다. 좌표는 논리 크기 640×360.
 */
export const W = 640;
export const H = 360;

export const COLORS = {
  board: "#0B2A55",
  panel: "#16113A",
  ink: "#10213D",
  white: "#FFFFFF",
  soft: "#BFDBFE",
  lilac: "#DBEAFE",
  violet: "#4A9BFF",
  lemon: "#F5C518",
  coral: "#FF8A7A",
  mint: "#6FE3D2",
} as const;

export type Pt = [number, number];

export type Op =
  | { op: "rect"; x: number; y: number; w: number; h: number; r?: number; fill: string; opacity?: number }
  | { op: "circle"; cx: number; cy: number; r: number; fill: string; opacity?: number }
  | {
      op: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      weight?: number;
      color: string;
      font?: "sans" | "mono";
      align?: "left" | "center" | "right";
      rotate?: number; // 도(°)
      opacity?: number;
    }
  | { op: "path"; points: Pt[]; stroke: string; width: number; opacity?: number }
  /** 색이 다른 조각을 이어 쓰는 한 줄 (코드). 글자 폭은 그리는 쪽이 잰다. cursor면 끝에 커서를 그린다. */
  | { op: "run"; x: number; y: number; size: number; parts: { text: string; color: string }[]; cursor?: string; opacity?: number };

export type Annotation =
  | { kind: "underline"; x1: number; y1: number; x2: number; at: number; dur?: number }
  | { kind: "circle"; cx: number; cy: number; rx: number; ry: number; at: number; dur?: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number; at: number; dur?: number }
  | { kind: "check"; x: number; y: number; size: number; at: number; dur?: number };

export interface Note {
  text: string;
  x: number;
  y: number;
  at: number;
  rotate?: number;
}

export type Scene =
  | { kind: "slide"; dur: number; title: string; bullets: string[]; marks?: Annotation[]; notes?: Note[] }
  | { kind: "code"; dur: number; title: string; lines: string[]; cps?: number; marks?: Annotation[]; notes?: Note[] }
  | {
      kind: "chart";
      dur: number;
      title: string;
      chart: "bar" | "line";
      labels: string[];
      values: number[]; // 0..1
      marks?: Annotation[];
      notes?: Note[];
    };

export interface Clip {
  /** 화면 위쪽에 계속 보이는 강 이름 */
  label: string;
  scenes: Scene[];
  captions: { at: number; text: string }[];
  seed: string;
}

export const clipDuration = (c: Clip) => c.scenes.reduce((a, s) => a + s.dur, 0);

// ───────────────────────── 보조 ─────────────────────────

/** 같은 문자열이면 같은 난수열. */
export function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);

/** 손으로 그린 듯한 선: 점마다 조금씩 흔들린다. */
function wobble(points: Pt[], seed: string, amp = 1.6): Pt[] {
  const r = rng(seed);
  return points.map(([x, y]) => [Math.round((x + (r() - 0.5) * amp * 2) * 10) / 10, Math.round((y + (r() - 0.5) * amp * 2) * 10) / 10]);
}

export function scribble(a: Annotation, seed: string): Pt[] {
  switch (a.kind) {
    case "underline": {
      const n = 14;
      const pts: Pt[] = [];
      for (let i = 0; i <= n; i++) pts.push([a.x1 + ((a.x2 - a.x1) * i) / n, a.y1 + Math.sin(i / 2.2) * 1.5]);
      return wobble(pts, seed, 1.2);
    }
    case "circle": {
      // 한 바퀴 조금 넘게 돌아 끝이 겹친다
      const n = 30;
      const pts: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const t = -0.6 + (i / n) * Math.PI * 2.15;
        const grow = 1 + (i / n) * 0.06;
        pts.push([a.cx + Math.cos(t) * a.rx * grow, a.cy + Math.sin(t) * a.ry * grow]);
      }
      return wobble(pts, seed, 1.8);
    }
    case "arrow": {
      const n = 12;
      const pts: Pt[] = [];
      const mx = (a.x1 + a.x2) / 2 + (a.y2 - a.y1) * 0.15;
      const my = (a.y1 + a.y2) / 2 - (a.x2 - a.x1) * 0.15;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push([
          (1 - t) * (1 - t) * a.x1 + 2 * (1 - t) * t * mx + t * t * a.x2,
          (1 - t) * (1 - t) * a.y1 + 2 * (1 - t) * t * my + t * t * a.y2,
        ]);
      }
      const ang = Math.atan2(a.y2 - pts[n - 1][1], a.x2 - pts[n - 1][0]);
      const head = 13;
      pts.push([a.x2 - head * Math.cos(ang - 0.5), a.y2 - head * Math.sin(ang - 0.5)]);
      pts.push([a.x2, a.y2]);
      pts.push([a.x2 - head * Math.cos(ang + 0.5), a.y2 - head * Math.sin(ang + 0.5)]);
      return wobble(pts, seed, 1);
    }
    case "check": {
      const s = a.size;
      return wobble([[a.x, a.y], [a.x + s * 0.35, a.y + s * 0.4], [a.x + s, a.y - s * 0.55]], seed, 1);
    }
  }
}

/** 진행률만큼만 앞에서부터 자른 선. */
export function partial(points: Pt[], progress: number): Pt[] {
  const p = clamp01(progress);
  if (p >= 1) return points;
  if (p <= 0 || points.length < 2) return [];
  const exact = p * (points.length - 1);
  const i = Math.floor(exact);
  const f = exact - i;
  const [x1, y1] = points[i];
  const [x2, y2] = points[Math.min(i + 1, points.length - 1)];
  return [...points.slice(0, i + 1), [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f]];
}

/** 코드 글자 색 (아주 단순한 강조). */
const KEYWORDS = /^(for|while|in|if|else|elif|def|return|import|from|print|range|const|let|function|SELECT|FROM|WHERE|GROUP|BY|ORDER|JOIN|ON)$/;
export function tokenize(line: string): { text: string; color: string }[] {
  const out: { text: string; color: string }[] = [];
  const re = /(#.*$|"[^"]*"?|'[^']*'?|\d+|[A-Za-z_]+|\s+|.)/g;
  for (const m of line.matchAll(re)) {
    const t = m[0];
    let color: string = COLORS.white;
    if (t.startsWith("#")) color = COLORS.soft;
    else if (t.startsWith('"') || t.startsWith("'")) color = COLORS.mint;
    else if (/^\d+$/.test(t)) color = COLORS.coral;
    else if (KEYWORDS.test(t)) color = COLORS.lemon;
    out.push({ text: t, color });
  }
  return out;
}


// ───────────────────────── 장면 그리기 ─────────────────────────

function drawMarks(ops: Op[], scene: Scene, u: number, seed: string) {
  for (const [i, m] of (scene.marks ?? []).entries()) {
    const p = (u - m.at) / (m.dur ?? 0.6);
    if (p <= 0) continue;
    const pts = partial(scribble(m, `${seed}:m${i}`), ease(p));
    if (pts.length > 1) ops.push({ op: "path", points: pts, stroke: COLORS.lemon, width: 3.5, opacity: 0.95 });
  }
  for (const n of scene.notes ?? []) {
    if (u < n.at) continue;
    ops.push({ op: "text", x: n.x, y: n.y, text: n.text, size: 19, weight: 800, color: COLORS.lemon, rotate: n.rotate ?? -4, opacity: ease((u - n.at) / 0.3) });
  }
}

function drawSlide(ops: Op[], s: Extract<Scene, { kind: "slide" }>, u: number) {
  ops.push({ op: "rect", x: 40, y: 58, w: 6, h: 34, r: 3, fill: COLORS.lemon });
  ops.push({ op: "text", x: 60, y: 86, text: s.title, size: 28, weight: 800, color: COLORS.white, opacity: ease(u / 0.35) });
  s.bullets.forEach((b, i) => {
    const at = 0.5 + i * 0.55;
    if (u < at) return;
    const o = ease((u - at) / 0.35);
    ops.push({ op: "circle", cx: 66, cy: 139 + i * 44, r: 4, fill: COLORS.lemon, opacity: o });
    ops.push({ op: "text", x: 82, y: 146 + i * 44, text: b, size: 20, weight: 500, color: COLORS.lilac, opacity: o });
  });
}

function drawCode(ops: Op[], s: Extract<Scene, { kind: "code" }>, u: number) {
  ops.push({ op: "text", x: 40, y: 50, text: s.title, size: 18, weight: 700, color: COLORS.soft });
  ops.push({ op: "rect", x: 40, y: 66, w: 560, h: 222, r: 14, fill: COLORS.panel });
  ["#FF8A7A", "#F5C518", "#6FE3D2"].forEach((c, i) => ops.push({ op: "circle", cx: 62 + i * 16, cy: 84, r: 4.5, fill: c }));
  const cps = s.cps ?? 30;
  let budget = Math.max(0, Math.floor((u - 0.25) * cps));
  const blink = Math.floor(u * 2.2) % 2 === 0;
  let cursorDone = false;
  s.lines.forEach((line, li) => {
    const y = 120 + li * 27;
    ops.push({ op: "text", x: 58, y, text: String(li + 1), size: 13, color: "#6B8FC4", font: "mono" });
    if (cursorDone) return;
    const parts: { text: string; color: string }[] = [];
    let typedAll = true;
    for (const tok of tokenize(line)) {
      if (budget <= 0) {
        typedAll = false;
        break;
      }
      const text = tok.text.slice(0, budget);
      budget -= text.length;
      if (text.length < tok.text.length) typedAll = false;
      parts.push({ text, color: tok.color });
    }
    const last = li === s.lines.length - 1;
    const here = !typedAll || budget <= 0 || last;
    if (typedAll) budget -= 1; // 줄바꿈도 한 글자
    const showCursor = here && blink;
    if (here) cursorDone = true;
    if (parts.length || showCursor) ops.push({ op: "run", x: 86, y, size: 17, parts, cursor: showCursor ? COLORS.lemon : undefined });
  });
}

/** 이 장면의 코드가 모두 쳐지는 데 걸리는 시간(초). */
export const typingDone = (s: Extract<Scene, { kind: "code" }>) => 0.25 + s.lines.reduce((a, l) => a + l.length + 1, 0) / (s.cps ?? 30);

function drawChart(ops: Op[], s: Extract<Scene, { kind: "chart" }>, u: number) {
  ops.push({ op: "text", x: 40, y: 56, text: s.title, size: 22, weight: 800, color: COLORS.white });
  const x0 = 70;
  const y0 = 290;
  const cw = 520;
  const ch = 190;
  ops.push({ op: "path", points: [[x0, y0 - ch - 6], [x0, y0], [x0 + cw, y0]], stroke: "#4A3F8F", width: 2 });
  const n = s.values.length;
  const step = cw / n;
  if (s.chart === "bar") {
    s.values.forEach((v, i) => {
      const g = ease((u - 0.3 - i * 0.18) / 0.7);
      const h = Math.max(0, v * ch * g);
      ops.push({ op: "rect", x: x0 + i * step + step * 0.22, y: y0 - h, w: step * 0.56, h, r: 6, fill: i === s.values.indexOf(Math.max(...s.values)) ? COLORS.lemon : COLORS.violet });
    });
  } else {
    const pts: Pt[] = s.values.map((v, i) => [x0 + i * step + step / 2, y0 - v * ch]);
    const drawn = partial(pts, ease((u - 0.3) / 1.6));
    if (drawn.length > 1) ops.push({ op: "path", points: drawn, stroke: COLORS.mint, width: 4 });
    drawn.forEach(([x, y], i) => {
      if (i < pts.length && pts[i][0] === x) ops.push({ op: "circle", cx: x, cy: y, r: 5, fill: COLORS.white });
    });
  }
  s.labels.forEach((l, i) =>
    ops.push({ op: "text", x: x0 + i * step + step / 2, y: y0 + 24, text: l, size: 14, color: COLORS.soft, align: "center" }),
  );
}

/** t초(클립 길이로 돌린다)의 화면. */
export function composeFrame(clip: Clip, t: number): Op[] {
  const total = clipDuration(clip);
  const time = total > 0 ? ((t % total) + total) % total : 0;
  const ops: Op[] = [{ op: "rect", x: 0, y: 0, w: W, h: H, fill: COLORS.board }];
  // 배경 격자 점 (칠판 느낌)
  for (let gx = 0; gx < 8; gx++) for (let gy = 0; gy < 4; gy++) ops.push({ op: "circle", cx: 600 - gx * 18, cy: 20 + gy * 18, r: 1.5, fill: "#3A3178" });

  let start = 0;
  let index = 0;
  for (; index < clip.scenes.length - 1; index++) {
    if (time < start + clip.scenes[index].dur) break;
    start += clip.scenes[index].dur;
  }
  const scene = clip.scenes[index];
  const u = time - start;
  const seed = `${clip.seed}:${index}`;
  if (scene?.kind === "slide") drawSlide(ops, scene, u);
  else if (scene?.kind === "code") drawCode(ops, scene, u);
  else if (scene?.kind === "chart") drawChart(ops, scene, u);
  if (scene) drawMarks(ops, scene, u, seed);

  // 강 이름 (위)과 자막 (아래)
  ops.push({ op: "text", x: 40, y: 26, text: clip.label, size: 13, weight: 600, color: "#8FB2E0" });
  const cap = [...clip.captions].reverse().find((c) => c.at <= time);
  if (cap) {
    ops.push({ op: "rect", x: W / 2 - 230, y: 312, w: 460, h: 32, r: 8, fill: "#000000", opacity: 0.45 });
    ops.push({ op: "text", x: W / 2, y: 334, text: cap.text, size: 15, weight: 500, color: COLORS.white, align: "center" });
  }
  return ops;
}

/** 움직임 줄이기·첫 화면용 정지 화면: 첫 장면이 다 그려진 뒤의 순간. */
export function posterTime(clip: Clip): number {
  const first = clip.scenes[0];
  return first ? Math.max(0, first.dur - 0.05) : 0;
}
