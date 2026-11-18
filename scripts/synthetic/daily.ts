/**
 * 매일 모드: 되채우기 뒤 같은 회원(같은 시드로 다시 만든다)이 오늘도 결제하고 강의를 본다. 한국 날짜 하루마다
 * 되채우기와 같은 모형(유형·요일·시험 달력·할인 기간을 앞으로 늘린 것)으로 계획을 세우고, 10분마다 그때까지
 * 된 몫만 지금 시각으로 서버 함수에 넣는다. 시청 조각은 끝난 시각이 지난 것만 넣고, 그 시각(지난 10분 안)을 쓴다.
 * 구독 갱신·해지는 서버의 주기 작업이 처리한다. 상태 파일이 있어 다시 켜도 두 번 넣지 않는다.
 * 앞으로 오는 사건: 11/19 수능 저녁 해설 라이브 폭주, 수능 뒤 수요 이동, 11월 말 할인, 1월 새해 수요.
 */
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addDays, kstDate, kstDateTime } from "@/rules/time";
import { db } from "@/server/db";
import { runJobsOnce } from "@/server/jobs";
import {
  type Ctx,
  dayStats,
  emptyExtra,
  emptyStats,
  ensureStaff,
  EventQueue,
  handle,
  loadCourses,
  loadUserIds,
  placeIntent,
  withSynthEnv,
} from "./engine";
import { buildModel, type DayPlan, LIVE_RATES, planDay } from "./model";
import { FILES, readJson, writeAtomic } from "./outdir";
import type { DailyState } from "./state";
import { trafficDay } from "./traffic";

export interface DailyOptions {
  out: string;
  intervalMin: number;
  once: boolean;
  maxLateH: number;
  log: (msg: string) => void;
  metrics?: boolean;
}

const MIN = 60_000;
const HOUR = 3_600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function takeLock(file: string): void {
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, "utf-8").trim());
    let alive = false;
    try {
      if (pid) {
        process.kill(pid, 0);
        alive = true;
      }
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`매일 모드가 이미 돌고 있어요(pid ${pid}). 같은 --out에는 하나만.`);
  }
  writeFileSync(file, String(process.pid));
}

export async function runDaily(o: DailyOptions): Promise<void> {
  const statePath = path.join(o.out, FILES.state);
  const state = readJson<DailyState>(statePath);
  if (!state) throw new Error(`${statePath}가 없어요. 되채우기(npm run synth)를 먼저 돌려 주세요.`);
  const lock = path.join(o.out, FILES.lock);
  takeLock(lock);
  const release = () => rmSync(lock, { force: true });
  process.once("exit", release);
  try {
    await withSynthEnv(() => dailyLoop(o, state, statePath));
  } finally {
    release();
  }
}

async function dailyLoop(o: DailyOptions, state: DailyState, statePath: string): Promise<void> {
  const log = o.log;
  if (o.metrics) log("--metrics: M7 지표 표가 아직 없어 traffic.jsonl에만 써요. (TODO: M7 합쳐지면 연결)");
  const model = buildModel({ seed: state.seed, windowEnd: state.windowEnd, cutoff: state.cutoff, members: state.members, newMembers: state.newMembers });
  const userIds = await loadUserIds();
  if (userIds.size !== model.members.length) {
    throw new Error(`DB의 가상 회원(${userIds.size})이 시드로 다시 만든 회원(${model.members.length})과 달라요. 되채우기를 다시(--replace) 해 주세요.`);
  }
  state.staffId = await ensureStaff();
  state.extra ??= emptyExtra();
  const stats = new Map(Object.entries(state.days).map(([d, s]) => [d, s.stats]));
  const ctx: Ctx = {
    model,
    staffId: state.staffId,
    userIds,
    courses: await loadCourses(),
    stats,
    queue: new EventQueue(state.queue),
    extra: state.extra,
    since: null,
    limit: () => Date.now(),
    log,
  };
  const plans = new Map<string, DayPlan>();
  const planOf = (d: string) => {
    let p = plans.get(d);
    if (!p) plans.set(d, (p = planDay(model, d)));
    return p;
  };
  let stop = false;
  const onSigint = () => {
    stop = true;
    log("멈추는 중… (이번 차례를 마치고 상태를 저장해요)");
  };
  process.once("SIGINT", onSigint);

  const save = () => {
    for (const [d, s] of ctx.stats) if (state.days[d]) state.days[d].stats = s;
    state.queue = ctx.queue.toArray();
    state.updatedAt = new Date().toISOString();
    writeAtomic(statePath, JSON.stringify(state));
  };

  const openDay = (d: string) => {
    const p = planOf(d);
    const s = emptyStats();
    s.planned = p.intents.length;
    state.days[d] = { next: 0, total: p.intents.length, finalized: false, stats: s };
    ctx.stats.set(d, s);
    ctx.queue.push({
      kind: "live_plan",
      t: kstDateTime(d, 0, 10).getTime(),
      from: kstDateTime(addDays(d, LIVE_RATES.planDaysBefore)).getTime(),
      to: kstDateTime(addDays(d, LIVE_RATES.planDaysBefore + 1)).getTime(),
    });
    log(`${d} 계획: 결제 ${p.intents.length}건 (자격증 ×${p.multipliers.CERT.toFixed(2)}, 수능·내신 ×${p.multipliers.EXAM.toFixed(2)})`);
  };

  const finalize = (d: string) => {
    const p = planOf(d);
    const s = ctx.stats.get(d) ?? emptyStats();
    const line = {
      date: d,
      seed: model.seed,
      dow_index: p.dowIndex,
      multipliers: Object.fromEntries(Object.entries(p.multipliers).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
      discount_share: p.discountShare,
      expected: Math.round(p.expected * 10) / 10,
      planned: p.intents.length,
      inserted: s.inserted,
      lost: s.lost,
      skipped: s.skipped ?? 0,
      missed: s.missed,
      by_kind: s.byKind,
      by_cat: s.byCat,
      followups: s.followups,
    };
    appendFileSync(path.join(o.out, FILES.dailyKey), `${JSON.stringify(line)}\n`, "utf-8");
    if (d > (state.trafficThrough ?? "")) {
      appendFileSync(path.join(o.out, FILES.traffic), trafficDay(model.seed, d).map((m) => JSON.stringify(m)).join("\n") + "\n", "utf-8");
      state.trafficThrough = d;
    }
    state.days[d].finalized = true;
    plans.delete(d);
    log(`${d} 마감: 계획 ${line.planned}건, 넣음 ${line.inserted}건, 놓침 ${line.missed}건`);
  };

  const tick = async () => {
    const now = new Date();
    const today = kstDate(now);
    const known = Object.keys(state.days).sort();
    for (let d = addDays(known[known.length - 1], 1); d <= today; d = addDays(d, 1)) openDay(d);
    save();

    // 끊겼던 결제 확인: 그 회원의 주문·구독이 그 뒤에 생겼으면 넣은 것으로 친다
    if (state.inflight) {
      const [d] = state.inflight.key.split("#");
      const day = state.days[d];
      const intent = planOf(d).intents.find((i) => i.key === state.inflight!.key);
      if (day && intent && day.next < day.total && planOf(d).intents[day.next].key === intent.key) {
        const uid = userIds.get(intent.member)!;
        const since = new Date(state.inflight.at - 5000);
        const found = (await db.order.count({ where: { user_id: uid, created_at: { gte: since } } })) + (await db.subscription.count({ where: { user_id: uid, created_at: { gte: since } } }));
        if (found) {
          const s = dayStats(ctx, d);
          s.inserted++;
          day.next++;
          log(`끊겼던 결제 ${intent.key}가 들어가 있어 이어 가요 (뒤따르는 시청·환불 계획은 건너뜀)`);
        }
      }
      state.inflight = null;
      save();
    }

    let placed = 0;
    let done = 0;
    for (;;) {
      if (stop) break;
      const at = Date.now();
      let bestDay: string | null = null;
      let bestT = Infinity;
      for (const [d, s] of Object.entries(state.days)) {
        if (s.finalized || s.next >= s.total) continue;
        const t = planOf(d).intents[s.next].t;
        if (t <= at && t < bestT) {
          bestT = t;
          bestDay = d;
        }
      }
      const top = ctx.queue.peek();
      const evDue = top && top.t <= at ? top : null;
      if (!bestDay && !evDue) break;
      if (bestDay && (!evDue || bestT <= evDue.t)) {
        const day = state.days[bestDay];
        const intent = planOf(bestDay).intents[day.next];
        if (at - intent.t > o.maxLateH * HOUR) {
          dayStats(ctx, bestDay).missed++;
          day.next++;
          continue;
        }
        state.inflight = { key: intent.key, at: Date.now() };
        save();
        await placeIntent(ctx, { ...intent, t: Date.now() });
        day.next++;
        state.inflight = null;
        save();
        placed++;
      } else if (evDue) {
        ctx.queue.pop();
        if (evDue.kind === "jobs") continue; // 주기 작업은 차례마다 돌린다
        if (evDue.kind === "watch" && evDue.t === evDue.sessionT && evDue.sessionT < at - o.intervalMin * MIN * 1.5) {
          // 꺼져 있던 동안 놓친 세션은 지금 시작한 것으로 (지난 시각으로 넣지 않는다)
          ctx.queue.push({ ...evDue, t: at + MIN, sessionT: at });
          continue;
        }
        await handle(ctx, evDue);
        done++;
        if (evDue.kind !== "watch") save();
      }
    }
    await runJobsOnce(new Date());

    for (const [d, s] of Object.entries(state.days)) if (!s.finalized && d < today && s.next >= s.total) finalize(d);
    for (const [d, s] of Object.entries(state.days)) if (s.finalized && d < addDays(today, -30)) delete state.days[d];
    for (const d of [...ctx.stats.keys()]) if (!state.days[d]) ctx.stats.delete(d);
    save();
    log(`차례 끝: 새 결제 ${placed}건, 다른 일 ${done}개, 남은 일 ${ctx.queue.size}개`);
  };

  for (;;) {
    await tick();
    if (o.once || stop) break;
    const wait = o.intervalMin * 60_000;
    for (let waited = 0; waited < wait && !stop; waited += 1000) await sleep(1000);
    if (stop) break;
  }
  process.off("SIGINT", onSigint);
}
