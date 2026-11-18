import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedRate } from "@/rules/progress";
import { addDays, kstDateTime } from "@/rules/time";
import { parseArgs } from "../scripts/gen-synthetic";
import { HEARTBEAT_SEC_FOR_SYNTH } from "../scripts/synthetic/engine";
import {
  AGE_SHARE,
  buildModel,
  calibration,
  catalog,
  CATEGORY_CODES,
  CATEGORY_SHARE,
  categoryMultipliers,
  certMultiplier,
  csatMultiplier,
  DEVICE_SHARE,
  DROP,
  examWave,
  FINAL_BY_CAT,
  FINAL_MEAN_TARGET,
  firstWatchAt,
  nextSession,
  PERSONAS,
  personaMass,
  planDay,
  PRODUCT_MIX,
  reachProb,
  REFUND_SKEW,
  sampleReach,
  SESSION_MIN,
  startChain,
  toeicMultiplier,
  WINDOW_DAYS,
  windowDays,
} from "../scripts/synthetic/model";
import { DEFAULT_OUT, outDirProblem, REPO_ROOT } from "../scripts/synthetic/outdir";
import { planSummary, planWindow } from "../scripts/synthetic/preview";
import { Rng } from "../scripts/synthetic/rng";
import { trafficDay } from "../scripts/synthetic/traffic";

const END = "2026-11-18";
const CUTOFF = kstDateTime(END, 15).getTime();
const small = (seed = 7) => buildModel({ seed, windowEnd: END, cutoff: CUTOFF, members: 3000, newMembers: 300 });
const sum = (v: readonly number[]) => v.reduce((a, b) => a + b, 0);
const mass = personaMass();
const aggregate = (rows: number[][], j: number, w: number[] = mass) => sum(rows.map((r, i) => r[j] * w[i])) / sum(w);

describe("가상 이용자: 비중", () => {
  it("설계 표의 비중은 모두 100%", () => {
    expect(sum(CATEGORY_CODES.map((c) => CATEGORY_SHARE[c]))).toBeCloseTo(100, 6);
    expect(sum(AGE_SHARE.map((a) => a[1]))).toBeCloseTo(100, 6);
    expect(sum(DEVICE_SHARE)).toBeCloseTo(100, 6);
    expect(sum(PRODUCT_MIX)).toBeCloseTo(100, 6);
    expect(sum(PERSONAS.map((p) => p.share))).toBeCloseTo(100, 6);
    expect(PERSONAS).toHaveLength(13);
  });

  it("유형별 분야·결제 구성은 행마다 합 1, 모두 더하면 설계 비중", () => {
    const c = calibration();
    for (const row of [...c.cat, ...c.buy]) expect(sum(row)).toBeCloseTo(1, 9);
    // 분야: 고3(수능만)·공인중개사(자격증만) 유형만으로 이미 목표를 조금 넘어 정확히는 맞출 수 없다 → 1%p 안
    CATEGORY_CODES.forEach((k, j) => expect(Math.abs(aggregate(c.cat, j) - CATEGORY_SHARE[k] / 100)).toBeLessThan(0.01));
    PRODUCT_MIX.forEach((v, j) => expect(aggregate(c.buy, j)).toBeCloseTo(v / 100, 3));
  });

  it("기기 구성은 연령대 기울기를 둔 채 전체가 설계 비중", () => {
    const c = calibration();
    const groups = ["teen", "adult", "senior"] as const;
    const w = groups.map((g) => sum(PERSONAS.filter((p) => (g === "teen" ? p.ages[1] < 20 : g === "senior" ? p.ages[0] >= 50 : p.ages[1] >= 20 && p.ages[0] < 50)).map((p) => p.share)));
    const rows = groups.map((g) => c.device[g]);
    for (const r of rows) expect(sum(r)).toBeCloseTo(1, 9);
    DEVICE_SHARE.forEach((v, j) => expect(aggregate(rows, j, w)).toBeCloseTo(v / 100, 3));
    expect(c.device.teen[2]).toBeGreaterThan(c.device.adult[2]); // 10대는 태블릿
    expect(c.device.senior[3]).toBeGreaterThan(c.device.adult[3]); // 50대 이상은 스마트폰
  });

  it("마지막 강까지 가는 비율은 분야 평균 약 17%, 환불 기울기는 평균 1", () => {
    expect(sum(CATEGORY_CODES.map((c) => FINAL_BY_CAT[c] * CATEGORY_SHARE[c])) / 100).toBeCloseTo(FINAL_MEAN_TARGET, 2);
    expect(sum(CATEGORY_CODES.map((c) => REFUND_SKEW[c] * CATEGORY_SHARE[c])) / 100).toBeCloseTo(1, 9);
    expect(REFUND_SKEW.LANG).toBeGreaterThan(REFUND_SKEW.CERT);
    expect(REFUND_SKEW.BIZ).toBeGreaterThan(REFUND_SKEW.EXAM);
  });

  it("평상시 하루 결제는 약 130건, 단과 72 · 패키지 8 · 월 16 · 연 4", () => {
    const { model, plans, cutoff } = planWindow(3, new Date(CUTOFF));
    const s = planSummary(model, plans, cutoff, false);
    expect(s.per_day).toBeGreaterThan(110);
    expect(s.per_day).toBeLessThan(150);
    expect(Math.abs(s.kind_share.single - 0.72)).toBeLessThan(0.03);
    expect(Math.abs(s.kind_share.bundle - 0.08)).toBeLessThan(0.02);
    expect(Math.abs(s.kind_share.monthly - 0.16)).toBeLessThan(0.02);
    expect(Math.abs(s.kind_share.yearly - 0.04)).toBeLessThan(0.01);
  }, 120_000);
});

describe("가상 이용자: 시드", () => {
  it("같은 시드면 회원과 하루 계획이 같다", () => {
    const a = small();
    const b = small();
    expect(a.members.slice(0, 50)).toEqual(b.members.slice(0, 50));
    expect(a.members.at(-1)).toEqual(b.members.at(-1));
    expect(planDay(a, "2026-11-02")).toEqual(planDay(b, "2026-11-02"));
    const ca = startChain(a, 5, catalog().courses[0].code, "k");
    expect(nextSession(a, ca, CUTOFF)).toEqual(nextSession(b, startChain(b, 5, catalog().courses[0].code, "k"), CUTOFF));
  });

  it("다른 시드면 다르다", () => {
    const a = small(7);
    const b = small(8);
    expect(a.members.slice(0, 20).map((m) => m.name + m.persona)).not.toEqual(b.members.slice(0, 20).map((m) => m.name + m.persona));
  });

  it("난수는 열쇠로만 정해진다", () => {
    const x = new Rng("k");
    const y = new Rng("k");
    expect([x.random(), x.normal(), x.poisson(3)]).toEqual([y.random(), y.normal(), y.poisson(3)]);
  });

  it("회원 3만 명 중 3천 명이 기간 안에 가입, 가입은 되채운 시각 전, 기기는 2대까지", () => {
    const m = buildModel({ seed: 1, windowEnd: END, cutoff: CUTOFF });
    expect(m.members).toHaveLength(30_000);
    const fresh = m.members.filter((x) => x.joinedInWindow);
    expect(fresh).toHaveLength(3_000);
    const start = kstDateTime(m.windowStart).getTime();
    for (const x of fresh) {
      expect(x.joinedAt).toBeGreaterThanOrEqual(start);
      expect(x.joinedAt).toBeLessThan(CUTOFF);
    }
    for (const x of m.members.filter((y) => !y.joinedInWindow)) expect(x.joinedAt).toBeLessThan(start);
    expect(new Set(m.members.map((x) => x.email)).size).toBe(30_000);
    for (const x of m.members.slice(0, 200)) {
      expect(x.email).toMatch(/^m\d{5}@synth\.studyon\.test$/);
      expect(x.devices.length).toBeGreaterThanOrEqual(1);
      expect(x.devices.length).toBeLessThanOrEqual(2);
      expect(new Set(x.devices).size).toBe(x.devices.length);
    }
  });
});

describe("가상 이용자: 기간", () => {
  const m = small();
  const days = windowDays(m);

  it("결제·시청한 날 기준 오늘 − 60일 ~ 오늘", () => {
    expect(m.windowStart).toBe(addDays(END, -WINDOW_DAYS));
    expect(days[0]).toBe("2026-09-19");
    expect(days.at(-1)).toBe(END);
    expect(days).toHaveLength(WINDOW_DAYS + 1);
  });

  it("기간 시작 전 결제·시청 계획은 하나도 없다", () => {
    const start = kstDateTime(m.windowStart).getTime();
    const end = kstDateTime(addDays(END, 1)).getTime();
    let n = 0;
    for (const d of days) {
      for (const i of planDay(m, d).intents) {
        n++;
        expect(i.t).toBeGreaterThanOrEqual(start);
        expect(i.t).toBeLessThan(end);
        expect(i.t).toBeGreaterThanOrEqual(kstDateTime(d).getTime());
        expect(i.t).toBeLessThan(kstDateTime(addDays(d, 1)).getTime());
        expect(i.t).toBeGreaterThan(m.members[i.member].joinedAt);
        expect(i.candidates.length).toBeGreaterThan(0);
        if (n % 7 === 0) {
          const chain = startChain(m, i.member, i.kind === "single" ? i.candidates[0] : catalog().courses[0].code, i.key);
          expect(firstWatchAt(m, chain, i.t)).toBeGreaterThan(i.t); // 시청은 결제 뒤
        }
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe("가상 이용자: 시험 달력", () => {
  it("정보처리기사 실기·공인중개사: D-30부터 오르고 시험 뒤 급락", () => {
    expect(examWave("2026-10-01", "2026-10-31", 1.1)).toBeCloseTo(1, 9); // D-30
    expect(examWave("2026-10-16", "2026-10-31", 1.1)).toBeCloseTo(1.55, 9); // D-15
    expect(examWave("2026-10-31", "2026-10-31", 1.1)).toBeCloseTo(2.1, 9); // 시험일
    expect(examWave("2026-11-01", "2026-10-31", 1.1)).toBe(0.6);
    expect(examWave("2026-11-06", "2026-10-31", 1.1)).toBe(0.6);
    expect(examWave("2026-11-07", "2026-10-31", 1.1)).toBe(1);
    expect(examWave("2026-09-30", "2026-10-31", 1.1)).toBe(1);
    expect(examWave("2026-11-13", "2026-11-13", 0.9)).toBeCloseTo(1.9, 9);
    expect(certMultiplier("2026-09-25")).toBe(1);
    expect(certMultiplier("2026-10-31")).toBeCloseTo(0.5 * 2.1 + 0.5 * (1 + 0.9 * (17 / 30)), 9);
    expect(certMultiplier("2026-11-14")).toBeCloseTo(0.5 * 1 + 0.5 * 0.6, 9);
  });

  it("수능 D-30부터 1.5배, 다음 날부터 수능 ×0.4·자격증·어학·개발 ×1.25", () => {
    expect(csatMultiplier("2026-10-19")).toBeCloseTo(1, 9);
    expect(csatMultiplier("2026-11-19")).toBeCloseTo(1.5, 9);
    expect(csatMultiplier("2026-10-18")).toBe(1);
    const before = categoryMultipliers("2026-11-18");
    const after = categoryMultipliers("2026-11-21");
    expect(after.EXAM).toBeCloseTo(0.4, 9);
    expect(after.DEV).toBeCloseTo(1.25, 9);
    expect(after.LANG).toBeCloseTo(1.25, 9);
    expect(after.DATA).toBe(1);
    expect(before.DEV).toBe(1);
  });

  it("토익 D-14 ×1.3 (토익 유형), 추석 ×0.85, 11월 말 할인 ×1.3, 1월 새해", () => {
    expect(toeicMultiplier("2026-11-01")).toBe(1.3);
    expect(toeicMultiplier("2026-10-31")).toBe(1);
    expect(toeicMultiplier("2026-11-16")).toBe(1.3); // 11/29 D-13
    expect(categoryMultipliers("2026-11-05", "toeic").LANG).toBe(1.3);
    expect(categoryMultipliers("2026-11-05").LANG).toBe(1);
    const ch = categoryMultipliers("2026-09-25");
    expect(ch.DEV).toBeCloseTo(0.85, 9);
    expect(ch.CERT).toBe(certMultiplier("2026-09-25"));
    expect(categoryMultipliers("2026-11-27").DATA).toBeCloseTo(1.3, 9);
    expect(categoryMultipliers("2027-01-10").LANG).toBeCloseTo(1.25 * 1.3, 9);
    expect(categoryMultipliers("2027-01-10").BIZ).toBeCloseTo(1.2, 9);
  });

  it("계획에서도 공인중개사 유형의 자격증 결제는 10/31 전에 늘고 뒤에 준다", () => {
    const m = buildModel({ seed: 7, windowEnd: END, cutoff: CUTOFF });
    const ri = PERSONAS.findIndex((p) => p.code === "realtor");
    const count = (d: string) => planDay(m, d).intents.filter((i) => i.persona === ri && i.cat === "CERT").length;
    const week = (from: string) => sum(Array.from({ length: 7 }, (_, k) => count(addDays(from, k))));
    expect(week("2026-10-25")).toBeGreaterThan(week("2026-11-01") * 1.5);
    expect(week("2026-10-25")).toBeGreaterThan(week("2026-09-20") * 1.4);
  }, 60_000);
});

describe("가상 이용자: 이탈 곡선", () => {
  it("1강 78% · 2강 56% · 3강 44%, 그 뒤 줄기만 하고 마지막 강은 분야 값", () => {
    for (const n of [9, 15, 20]) {
      for (const f of [0.1, 0.17, 0.3]) {
        expect(reachProb(1, n, f)).toBe(DROP.first);
        expect(reachProb(2, n, f)).toBe(DROP.second);
        expect(reachProb(3, n, f)).toBe(DROP.third);
        expect(reachProb(n, n, f)).toBeCloseTo(f, 9);
        for (let k = 2; k <= n; k++) expect(reachProb(k, n, f)).toBeLessThanOrEqual(reachProb(k - 1, n, f) + 1e-12);
        // 1~3강에서 가파르게: 앞 두 칸이 나머지 한 칸보다 크게 떨어진다
        expect(reachProb(1, n, f) - reachProb(3, n, f)).toBeGreaterThan((reachProb(3, n, f) - reachProb(n, n, f)) / (n - 3) * 5);
      }
    }
  });

  it("뽑은 결과도 곡선을 따른다 (자격증은 디자인보다 끝까지 많이)", () => {
    const rng = new Rng("reach");
    const draws = 40_000;
    const n = 15;
    const at = (f: number) => {
      const r = Array.from({ length: draws }, () => sampleReach(rng.random(), n, f));
      const share = (k: number) => r.filter((x) => x >= k).length / draws;
      return { first: share(1), third: share(3), last: share(n) };
    };
    const cert = at(FINAL_BY_CAT.CERT);
    const dsgn = at(FINAL_BY_CAT.DSGN);
    expect(Math.abs(cert.first - 0.78)).toBeLessThan(0.01);
    expect(Math.abs(cert.third - 0.44)).toBeLessThan(0.01);
    expect(Math.abs(cert.last - 0.3)).toBeLessThan(0.01);
    expect(Math.abs(dsgn.last - 0.1)).toBeLessThan(0.01);
  });

  it("세션은 25~40분, 배속은 서버가 받는 값, 조각 하나는 하트비트 한 번에 들어간다", () => {
    const m = small();
    let checked = 0;
    for (const c of catalog().courses.slice(0, 20)) {
      let chain = startChain(m, 11, c.code, `t:${c.code}`);
      chain = { ...chain, reach: c.durations.length, lastFrac: 1 };
      for (let k = 0; k < 30; k++) {
        const s = nextSession(m, chain, CUTOFF);
        if (!s) break;
        const last = s.pieces.at(-1)!;
        const wallMin = (last.at + (last.to - last.from) / last.rate) / 60;
        if (!s.last) expect(wallMin).toBeGreaterThanOrEqual(SESSION_MIN[0] - 1.5);
        expect(wallMin).toBeLessThanOrEqual(SESSION_MIN[1] + 2);
        for (const p of s.pieces) {
          expect(isAllowedRate(p.rate)).toBe(true);
          expect(p.to).toBeLessThanOrEqual(c.durations[p.lec]);
          expect(p.to).toBeGreaterThan(p.from);
          expect((p.to - p.from) / p.rate).toBeLessThanOrEqual(3 * HEARTBEAT_SEC_FOR_SYNTH);
          expect(p.to - p.from).toBeLessThanOrEqual(((p.to - p.from) / p.rate) * p.rate * 1.2 + 5);
          checked++;
        }
        chain = { ...s.after, seq: s.after.seq };
        if (s.last) break;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe("가상 이용자: 지표 계획", () => {
  it("11/2 09:00~09:40만 진도 저장 오류 35%, 10/31 19시 자격증 페이지는 평소의 약 4배 이상", () => {
    const fault = trafficDay(1, "2026-11-02").filter((x) => x.tags.includes("fault_progress_save"));
    expect(fault).toHaveLength(40);
    expect(fault[0].kst).toBe("2026-11-02 09:00");
    expect(fault.at(-1)!.kst).toBe("2026-11-02 09:39");
    for (const x of fault) expect(x.error_rate).toBe(0.35);
    const sat = trafficDay(1, "2026-10-31");
    const prev = trafficDay(1, "2026-10-24");
    const at = (rows: typeof sat, kst: string) => rows.find((x) => x.kst.endsWith(kst))!;
    expect(at(sat, "19:30").queue_on).toBe(true);
    expect(at(sat, "19:30").page_views_cert / at(prev, "19:30").page_views_cert).toBeGreaterThan(3);
    expect(trafficDay(1, "2026-11-01").every((x) => x.error_rate < 0.01)).toBe(true);
  });
});

describe("가상 이용자: 옵션·정답지 위치", () => {
  const gi = readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf-8");

  it("옵션", () => {
    expect(parseArgs([])).toMatchObject({ seed: 20261118, dryRun: false, replace: false, metrics: false, intervalMin: 10 });
    expect(parseArgs(["--seed", "5", "--dry-run", "--replace", "--force", "--metrics", "--out", "x"])).toMatchObject({ seed: 5, dryRun: true, replace: true, force: true, metrics: true, out: "x" });
    expect(() => parseArgs(["--nope"])).toThrow();
  });

  it("기본 --out(synthetic-out/)은 .gitignore에 있다", () => {
    expect(gi.split(/\r?\n/)).toContain(`${DEFAULT_OUT}/`);
    expect(outDirProblem(path.join(REPO_ROOT, DEFAULT_OUT), REPO_ROOT, gi)).toBeNull();
  });

  it("저장소 안 다른 곳(맨 위·scripts·tests·prisma)에는 쓰지 않는다", () => {
    expect(outDirProblem(REPO_ROOT, REPO_ROOT, gi)).not.toBeNull();
    expect(outDirProblem(path.join(REPO_ROOT, "scripts", "out"), REPO_ROOT, gi)).not.toBeNull();
    expect(outDirProblem(path.join(REPO_ROOT, "tests"), REPO_ROOT, gi)).not.toBeNull();
    expect(outDirProblem(path.join(REPO_ROOT, "prisma"), REPO_ROOT, gi)).not.toBeNull();
  });

  it("저장소 밖은 괜찮다", () => {
    expect(outDirProblem(path.join(tmpdir(), "studyon-synth"), REPO_ROOT, gi)).toBeNull();
  });
});
