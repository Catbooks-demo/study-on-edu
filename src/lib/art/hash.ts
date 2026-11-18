/** 문자열 → 32비트 정수 (FNV-1a). 생성 그림이 같은 입력이면 늘 같게. */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export const unit = (s: string) => (hash32(s) % 10000) / 10000;
