/** 시드로 정해지는 난수. 같은 열쇠(문자열)면 어디서 몇 번을 돌려도 같은 값이 나온다. */

/** 문자열 → 32비트 시드 (xmur3). */
function seedOf(key: string): () => number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(key: string) {
    const s = seedOf(key);
    this.a = s();
    this.b = s();
    this.c = s();
    this.d = s();
    for (let i = 0; i < 12; i++) this.next();
  }

  /** sfc32: 0 이상 2^32 미만 정수. */
  private next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    const t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const r = (t + this.d) | 0;
    this.c = (this.c + r) | 0;
    return r >>> 0;
  }

  /** 0 이상 1 미만. */
  random(): number {
    return this.next() / 4294967296;
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }

  /** lo 이상 hi 이하 정수. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.random() < p;
  }

  /** ±30% 안 개인 편차. */
  jitter(width = 0.3): number {
    return this.uniform(1 - width, 1 + width);
  }

  /** 가중치 목록에서 번호 하나. */
  index(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let u = this.random() * total;
    for (let i = 0; i < weights.length; i++) {
      u -= weights[i];
      if (u < 0) return i;
    }
    return weights.length - 1;
  }

  pick<T>(items: readonly T[], weights?: readonly number[]): T {
    if (!weights) return items[Math.floor(this.random() * items.length)];
    return items[this.index(weights)];
  }

  /** 표준 정규분포 (Box–Muller). */
  normal(): number {
    let u = 0;
    while (u === 0) u = this.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.random());
  }

  /** 평균이 mean인 로그정규 (긴 꼬리). sigma는 로그 눈금의 표준편차. */
  lognormal(mean: number, sigma: number): number {
    return mean * Math.exp(sigma * this.normal() - (sigma * sigma) / 2);
  }

  /** 포아송. 큰 평균은 정규 근사. */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 60) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    for (;;) {
      p *= this.random();
      if (p <= limit) return k;
      k++;
    }
  }
}

/** 누적합 (이분 탐색으로 가중 선택할 때). */
export function cumulative(weights: readonly number[]): number[] {
  const out: number[] = [];
  let s = 0;
  for (const w of weights) {
    s += w;
    out.push(s);
  }
  return out;
}

/** 누적합에서 u(0~합)가 떨어지는 번호. */
export function bisect(cum: readonly number[], u: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] > u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
