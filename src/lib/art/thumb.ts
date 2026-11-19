import { hash32, unit } from "./hash";

/** 분야별 색 두 벌 (그라데이션 시작·끝·잉크). */
export const CATEGORY_PALETTES: Record<string, { from: string; to: string; ink: string; accent: string }[]> = {
  DEV: [
    { from: "#0A62D6", to: "#5AA4FF", ink: "#FFFFFF", accent: "#F5C518" },
    { from: "#082A5A", to: "#0F7BFF", ink: "#FFFFFF", accent: "#6FE3D2" },
  ],
  DATA: [
    { from: "#0C7F78", to: "#5FD9C6", ink: "#FFFFFF", accent: "#F5C518" },
    { from: "#0F4C5C", to: "#2BB3A3", ink: "#FFFFFF", accent: "#FFB0A0" },
  ],
  CERT: [
    { from: "#F5C518", to: "#FF9F43", ink: "#10213D", accent: "#0F7BFF" },
    { from: "#FAD96A", to: "#F5C518", ink: "#10213D", accent: "#E2475F" },
  ],
  LANG: [
    { from: "#E2475F", to: "#FFA391", ink: "#FFFFFF", accent: "#F5C518" },
    { from: "#B8325A", to: "#F2788E", ink: "#FFFFFF", accent: "#FFE7A0" },
  ],
  DSGN: [
    { from: "#0A62D6", to: "#7FBCFF", ink: "#FFFFFF", accent: "#F5C518" },
    { from: "#0B3A7A", to: "#3D8DFF", ink: "#FFFFFF", accent: "#6FE3D2" },
  ],
  BIZ: [
    { from: "#0E7A4E", to: "#8EDDA8", ink: "#FFFFFF", accent: "#F5C518" },
    { from: "#1D4D3A", to: "#3FAE74", ink: "#FFFFFF", accent: "#FAD96A" },
  ],
  EXAM: [
    { from: "#10213D", to: "#4A3FB0", ink: "#FFFFFF", accent: "#F5C518" },
    { from: "#0B3A7A", to: "#4A9BFF", ink: "#FFFFFF", accent: "#FFB0A0" },
  ],
};

export type Pattern = "dots" | "grid" | "stripes";
const PATTERNS: Pattern[] = ["dots", "grid", "stripes"];

export interface ThumbSpec {
  variant: number; // 0..3: 그림 배치
  palette: number; // 0..1
  pattern: Pattern;
  mirror: boolean;
  angle: number; // 그라데이션 각도
}

/**
 * 강의 썸네일 설정. 강의 코드로만 정해진다.
 * 같은 분야에서 번호가 이어지는 강의는 배치(variant)가 늘 달라 나란히 있어도 같은 그림이 되지 않는다.
 */
export function thumbSpec(code: string): ThumbSpec {
  const n = Number(code.match(/(\d+)$/)?.[1] ?? hash32(code) % 1000);
  const h = hash32(code);
  const palette = Math.floor(unit(`${code}:p`) * 2);
  return {
    variant: n % 4,
    palette,
    pattern: PATTERNS[(n + palette + (h % 3)) % 3],
    mirror: unit(`${code}:m`) < 0.5,
    angle: 15 + (h % 50),
  };
}

/** 제목을 줄 단위로 (띄어쓰기에서 먼저 끊고, 줄이 넘치면 줄임표). */
export function wrapTitle(text: string, perLine: number, maxLines: number): string[] {
  // 한 줄보다 긴 낱말은 줄 길이로 쪼갠다 ("TypeScript로" → "TypeScr", "ipt로")
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => {
      const ch = [...w];
      if (ch.length <= perLine) return [w];
      const out: string[] = [];
      for (let i = 0; i < ch.length; i += perLine) out.push(ch.slice(i, i + perLine).join(""));
      return out;
    });
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if ([...next].length <= perLine) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = [...kept[maxLines - 1]];
    kept[maxLines - 1] = `${last.slice(0, Math.max(1, perLine - 1)).join("")}…`;
    return kept;
  }
  return lines;
}
