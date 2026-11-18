/** 미리보기(--dry-run)와 되채우기가 같이 쓰는 계획. DB를 건드리지 않는다. */
import { kstDate } from "../../src/rules/time";
import {
  buildModel,
  catalog,
  CATEGORY_CODES,
  type Chain,
  chainRatio,
  type DayPlan,
  firstWatchAt,
  type Intent,
  type Model,
  nextSession,
  nextSessionAt,
  PERSONAS,
  PLANTED,
  PRODUCT_KINDS,
  planDay,
  startChain,
  windowDays,
} from "./model";

const MIN = 60_000;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** 계획만 (DB 없이): 미리보기와 정답지가 같은 함수를 쓴다. */
export function planWindow(seed: number, now: Date, size: { members?: number; newMembers?: number } = {}) {
  const today = kstDate(now);
  const cutoff = now.getTime() - MIN;
  const model = buildModel({ seed, windowEnd: today, cutoff, ...size });
  const plans = windowDays(model).map((d) => planDay(model, d));
  return { today, cutoff, model, plans };
}

/** 결제 하나로 생기는 시청 흐름들 (강의마다 하나). 패키지 두 번째 강의부터는 늦게·덜 본다. */
export function chainsFor(model: Model, intent: Intent, courses: string[], t0: number): { chain: Chain; firstT: number }[] {
  const sub = intent.kind === "monthly" || intent.kind === "yearly";
  const refundEarly = !!intent.fate.refund?.early && !sub;
  return courses.map((course, i) => {
    const chain = startChain(model, intent.member, course, `${intent.key}:${course}`, {
      sub,
      scale: i === 0 ? 1 : 0.7,
      refundEarly: refundEarly && i === 0,
    });
    if (refundEarly && i > 0) chain.reach = 0;
    const delay = i === 0 ? 0 : i * (sub ? 6 : 9);
    return { chain, firstT: firstWatchAt(model, chain, t0, delay) };
  });
}

/** 결제 하나가 여는 강의 (단과 첫 후보, 패키지 강의, 구독이 볼 강의). */
export function coursesOf(intent: Intent, chosen: string): string[] {
  if (intent.kind === "single") return [chosen];
  if (intent.kind === "bundle") return catalog().bundles.find((b) => b.code === chosen)?.courses ?? [];
  return intent.candidates;
}

/** 시청을 DB 없이 흉내 내어 센다 (미리보기용 어림: 환불·구독 해지·장애는 빼고). */
export function estimateWatch(model: Model, plans: DayPlan[], cutoff: number) {
  let sessions = 0;
  let rows = 0;
  let completions = 0;
  let enrollments = 0;
  const learnersByDay = new Map<string, Set<number>>();
  for (const p of plans) {
    for (const it of p.intents) {
      if (it.t > cutoff) continue;
      const first = it.candidates[0];
      if (!first) continue;
      for (const { chain: c0, firstT } of chainsFor(model, it, coursesOf(it, first), it.t)) {
        enrollments++;
        let chain = c0;
        let t = firstT;
        let done = false;
        for (let guard = 0; guard < 200 && t <= cutoff; guard++) {
          const s = nextSession(model, chain, t);
          if (!s) break;
          sessions++;
          rows += s.pieces.length;
          const day = kstDate(new Date(t));
          let set = learnersByDay.get(day);
          if (!set) learnersByDay.set(day, (set = new Set()));
          set.add(chain.member);
          chain = s.after;
          if (!done && chainRatio(chain) >= 0.8) {
            completions++;
            done = true;
          }
          if (s.last) break;
          const lastPiece = s.pieces[s.pieces.length - 1];
          t = nextSessionAt(model, chain, t + (lastPiece.at + (lastPiece.to - lastPiece.from) / lastPiece.rate) * 1000);
        }
      }
    }
  }
  const days = [...learnersByDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  return {
    enrollments,
    sessions,
    watch_event_rows: rows,
    completions_80pct: completions,
    learners_per_day_first_week: Math.round(days.slice(0, 7).reduce((s, [, v]) => s + v.size, 0) / Math.max(1, Math.min(7, days.length))),
    learners_per_day_last_week: Math.round(days.slice(-7).reduce((s, [, v]) => s + v.size, 0) / Math.max(1, Math.min(7, days.length))),
  };
}

export function planSummary(model: Model, plans: DayPlan[], cutoff: number, withWatch = true) {
  const intents = plans.flatMap((p) => p.intents).filter((i) => i.t <= cutoff);
  const n = Math.max(1, intents.length);
  const byKind = Object.fromEntries(PRODUCT_KINDS.map((k) => [k, intents.filter((i) => i.kind === k).length]));
  const byCat = Object.fromEntries(CATEGORY_CODES.map((c) => [c, intents.filter((i) => i.cat === c && (i.kind === "single" || i.kind === "bundle")).length]));
  const day = (d: string) => plans.find((p) => p.date === d);
  const mult = (d: string) => {
    const p = day(d);
    return p ? { CERT: round3(p.multipliers.CERT), EXAM: round3(p.multipliers.EXAM), planned: p.intents.length } : null;
  };
  return {
    window: { start: model.windowStart, end: model.windowEnd, days: plans.length, basis: "결제하거나 강의를 본 날(KST)" },
    members: model.members.length,
    joined_in_window: model.members.filter((m) => m.joinedInWindow).length,
    personas: PERSONAS.map((p, i) => ({ code: p.code, members: model.members.filter((m) => m.persona === i).length })),
    planned_purchases: intents.length,
    per_day: Math.round((intents.length / plans.length) * 10) / 10,
    by_kind: byKind,
    kind_share: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, round3(v / n)])),
    by_category_single_bundle: byCat,
    planned_refunds: intents.filter((i) => i.fate.refund).length,
    planned_inquiries: intents.filter((i) => i.fate.inquiry).length,
    exam_days: {
      "2026-09-25 추석": mult("2026-09-25"),
      "2026-10-31 공인중개사": mult("2026-10-31"),
      "2026-11-13 정처기 실기 끝": mult("2026-11-13"),
      "2026-11-14 시험 뒤": mult("2026-11-14"),
      "2026-11-18 수능 D-1": mult("2026-11-18"),
    },
    planted: {
      cert_spike: `${PLANTED.certSpike.date} ${PLANTED.certSpike.fromHour}~${PLANTED.certSpike.toHour}시 자격증 해설 접속 약 ×${PLANTED.certSpike.factor}`,
      fault: `${PLANTED.fault.date} 09:00~09:40 진도 저장 오류 ${PLANTED.fault.errorRate * 100}% · 문의 약 ${PLANTED.fault.inquiries}건 · ${PLANTED.fault.compensation.date} 보상 쿠폰`,
      csat_live: `${PLANTED.csatLive.date} ${PLANTED.csatLive.hour}시 수능 해설 라이브 (매일 모드)`,
    },
    watch_estimate: withWatch ? estimateWatch(model, plans, cutoff) : null,
  };
}
