/**
 * 되채우기: 학습자가 결제하거나 강의를 본 날 기준 지난 60일(오늘 − 60일 ~ 지금)을 한 번에 넣는다.
 * 사건(결제·시청·환불·구독·질문·라이브)을 시각 순으로 그 시각의 now로 서버 함수에 넣고, 끝나면 정답지·회원 표·
 * 분 단위 지표 계획(traffic.jsonl)·매일 모드 상태를 --out에 쓴다.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { addDays, kstDate, kstDateTime } from "@/rules/time";
import { answerKey, personaCsv } from "./answerkey";
import {
  countSynthetic,
  type Ctx,
  deleteSynthetic,
  emptyExtra,
  emptyStats,
  ensureCoupons,
  ensureLives,
  ensureStaff,
  EventQueue,
  handle,
  insertMembers,
  loadCourses,
  loadUserIds,
  placeIntent,
  recentJobRun,
  withSynthEnv,
} from "./engine";
import { LIVE_RATES, PLANTED, windowDays } from "./model";
import { FILES, writeAtomic } from "./outdir";
import { planWindow } from "./preview";
import type { DailyState } from "./state";
import { trafficRange } from "./traffic";

const MIN = 60_000;

export interface BackfillOptions {
  seed: number;
  out: string;
  replace: boolean;
  force: boolean;
  log: (msg: string) => void;
  /** 시험용: 회원 수 (기본 3만 명, 그중 10% 기간 안 가입). */
  members?: number;
  /** 시험용: 지금 시각. */
  now?: Date;
  /** M7 지표 표에 쓰기 (아직 자리만). */
  metrics?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runBackfill(o: BackfillOptions): Promise<void> {
  await withSynthEnv(() => backfill(o));
}

async function backfill(o: BackfillOptions): Promise<void> {
  const log = o.log;
  const started = o.now ?? new Date();
  const size = o.members ? { members: o.members, newMembers: Math.round(o.members / 10) } : {};
  const { today, cutoff, model, plans } = planWindow(o.seed, started, size);
  log(`기간 ${model.windowStart} ~ ${today} (결제·시청한 날 기준), 결제 계획 ${plans.reduce((s, p) => s + p.intents.length, 0)}건`);

  // ── 확인 ──
  const existing = await countSynthetic();
  if ((existing.users || existing.orders || existing.staff) && !o.replace) {
    throw new Error(`이미 가상 데이터가 있어요(회원 ${existing.users}, 주문 ${existing.orders}). 지우고 다시 넣으려면 --replace.`);
  }
  const recent = await recentJobRun(15 * MIN);
  if (recent && !o.force) {
    throw new Error(
      `앱의 주기 작업이 ${recent.toISOString()}에 돌았어요. 되채우기는 지난 시각으로 처리하므로, 그동안 앱을 멈추거나 JOBS_ENABLED=false로 켜 주세요(--force로 무시).`,
    );
  }
  if (o.replace) {
    const n = await deleteSynthetic();
    log(`가상 데이터 지움: ${JSON.stringify(n)}`);
    for (const f of [FILES.state, FILES.dailyKey]) rmSync(path.join(o.out, f), { force: true });
  }
  if (o.metrics) log("--metrics: M7 지표 표가 아직 없어 traffic.jsonl과 정답지에만 써요. (TODO: M7 합쳐지면 연결)");

  // ── 준비 ──
  const staffId = await ensureStaff();
  await ensureCoupons(model.windowStart);
  await insertMembers(model, log);
  const userIds = await loadUserIds();
  if (userIds.size !== model.members.length) throw new Error(`가상 회원 수가 맞지 않아요: DB ${userIds.size}, 모형 ${model.members.length}`);
  const courses = await loadCourses();
  const ctx: Ctx = { model, staffId, userIds, courses, stats: new Map(), queue: new EventQueue(), extra: emptyExtra(), since: null, limit: () => cutoff, log };
  const lives = await ensureLives(ctx, model.windowStart, today);
  log(`지난 라이브·수능 해설 라이브 새로 ${lives}개`);

  for (const p of plans) {
    const s = emptyStats();
    s.planned = p.intents.filter((i) => i.t <= cutoff).length;
    ctx.stats.set(p.date, s);
  }
  const startMs = kstDateTime(model.windowStart).getTime();
  for (const d of windowDays(model)) {
    for (let h = 0; h < 24; h++) {
      const t = kstDateTime(d, h, 2).getTime();
      if (t <= cutoff) ctx.queue.push({ kind: "jobs", t }); // 구독 갱신·재시도·해지, 결제 기한, 라이브 상태
    }
    const lp = kstDateTime(d, 0, 10).getTime();
    ctx.queue.push({ kind: "live_plan", t: lp, from: kstDateTime(addDays(d, LIVE_RATES.planDaysBefore)).getTime(), to: kstDateTime(addDays(d, LIVE_RATES.planDaysBefore + 1)).getTime() });
  }
  ctx.queue.push({ kind: "live_plan", t: startMs, from: startMs, to: kstDateTime(addDays(model.windowStart, LIVE_RATES.planDaysBefore)).getTime() });
  // 심어 둔 사건 (기간 밖이면 지난 것은 빼고, 앞으로 올 것은 매일 모드로 넘긴다)
  const planted = [
    { kind: "cert_spike" as const, t: kstDateTime(PLANTED.certSpike.date, PLANTED.certSpike.fromHour - 1, 55).getTime() },
    { kind: "fault_surge" as const, t: kstDateTime(PLANTED.fault.date, 9, 5).getTime() },
    { kind: "compensate" as const, t: kstDateTime(PLANTED.fault.compensation.date, PLANTED.fault.compensation.hour).getTime() },
  ];
  for (const ev of planted) if (ev.t >= startMs) ctx.queue.push(ev);

  // ── 시각 순으로 넣기 ──
  await sleep(2500);
  ctx.since = new Date(Date.now() - 1000);
  const intents = plans.flatMap((p) => p.intents);
  let ii = 0;
  let steps = 0;
  let placed = 0;
  const t0 = Date.now();
  for (;;) {
    const ni = ii < intents.length && intents[ii].t <= cutoff ? intents[ii] : null;
    const top = ctx.queue.peek();
    const ne = top && top.t <= cutoff ? top : null;
    if (!ni && !ne) break;
    if (ni && (!ne || ni.t <= ne.t)) {
      ii++;
      if (await placeIntent(ctx, ni)) placed++;
    } else if (ne) {
      ctx.queue.pop();
      await handle(ctx, ne);
    }
    if (++steps % 2000 === 0) log(`… ${steps}개 처리 (결제 ${placed}건, ${kstDate(new Date((ni ?? ne)!.t))}, ${Math.round((Date.now() - t0) / 1000)}초)`);
  }
  log(`넣기 끝: 결제 ${placed}건, 사건 ${steps}개, ${Math.round((Date.now() - t0) / 1000)}초`);

  // ── 매일 모드로 넘길 상태 ──
  const state: DailyState = {
    version: 1,
    seed: o.seed,
    windowStart: model.windowStart,
    windowEnd: today,
    cutoff,
    members: model.members.length,
    newMembers: model.members.filter((m) => m.joinedInWindow).length,
    staffId,
    days: Object.fromEntries(
      plans.map((p) => [
        p.date,
        {
          next: p.date === today ? p.intents.filter((i) => i.t <= cutoff).length : p.intents.length,
          total: p.intents.length,
          finalized: p.date < today,
          stats: ctx.stats.get(p.date) ?? emptyStats(),
        },
      ]),
    ),
    queue: ctx.queue.toArray().filter((e) => e.kind !== "jobs"),
    extra: ctx.extra,
    inflight: null,
    trafficThrough: addDays(today, -1),
    updatedAt: new Date().toISOString(),
  };

  // 분 단위 지표 계획: 기간 첫날 ~ 어제(오늘 몫은 매일 모드가 하루가 끝나면 쓴다)
  const traffic = trafficRange(o.seed, model.windowStart, today, cutoff);
  const done = traffic.filter((m) => m.kst.slice(0, 10) < today);
  writeAtomic(path.join(o.out, FILES.traffic), done.map((m) => JSON.stringify(m)).join("\n") + "\n");
  const key = await answerKey(model, plans, ctx, cutoff, traffic);
  writeAtomic(path.join(o.out, FILES.answerKey), JSON.stringify(key, null, 2));
  writeAtomic(path.join(o.out, FILES.personas), personaCsv(model));
  writeAtomic(path.join(o.out, FILES.state), JSON.stringify(state));
  log(`정답지: ${path.join(o.out, FILES.answerKey)} (로컬 전용, 커밋·공유 금지)`);
  log(`매일 모드 상태: ${path.join(o.out, FILES.state)} (남은 일 ${state.queue.length}개)`);
}
