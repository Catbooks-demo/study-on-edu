import { hash32, unit } from "./hash";

const PALETTES = [
  ["#5B3DF5", "#F5C518", "#E3DDFF"],
  ["#1B1A2E", "#7F66F9", "#F5C518"],
  ["#0C7F78", "#6FE3D2", "#FAFAF7"],
  ["#E2475F", "#FFD7CF", "#5B3DF5"],
  ["#F5C518", "#1B1A2E", "#FFFFFF"],
  ["#9A2FC0", "#F09BE2", "#FAD96A"],
  ["#0E7A4E", "#8EDDA8", "#1B1A2E"],
  ["#3C24B8", "#C8BBFF", "#FF8A7A"],
] as const;

export type AvatarShape = "orbit" | "split" | "stack" | "petal";
const SHAPES: AvatarShape[] = ["orbit", "split", "stack", "petal"];

export interface AvatarSpec {
  bg: string;
  fg: string;
  accent: string;
  shape: AvatarShape;
  rotate: number; // 0, 45, 90 … 315
  dot: [number, number]; // 작은 점 위치 (0..100)
}

/** 해시 소금. 시드 강사 20명이 서로 다른 색·모양·방향을 갖도록 고른 값이에요(tests/art.test.ts가 확인). */
const SALT = "v100";

/** 가상 강사 추상 아바타. slug로만 정해진다(사람 얼굴이 아니다). */
export function avatarSpec(slug: string): AvatarSpec {
  const key = `${SALT}:${slug}`;
  const h = hash32(key);
  const [bg, fg, accent] = PALETTES[h % PALETTES.length];
  return {
    bg,
    fg,
    accent,
    shape: SHAPES[Math.floor(unit(`${key}:s`) * SHAPES.length)],
    rotate: Math.floor(unit(`${key}:r`) * 8) * 45,
    dot: [22 + Math.floor(unit(`${key}:x`) * 56), 22 + Math.floor(unit(`${key}:y`) * 56)],
  };
}
