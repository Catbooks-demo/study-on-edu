import { db } from "./db";
import { BUCKETS, type Slot, SAMPLE_CAP, bumpSlowQuery, metricsState, resetMetricsState } from "./metrics-state";

/**
 * 지표 (Prometheus 텍스트, 접두사 studyon_). 요청·결제·작업 수는 앱 메모리에서,
 * 동시 재생·대기열·DB 연결 수는 내보낼 때 DB에서 센다. 개인정보(이메일·이름·id)는 라벨에 넣지 않는다.
 */
export const PREFIX = "studyon_";

/** 경로 조각 중 숫자·@·%가 든 것(id·주문번호·강의 코드·이메일)을 :id로 바꾼다. 버전 조각(v1)은 그대로. */
export function routeGroup(pathname: string): string {
  const parts = pathname.split("?")[0].split("/").map((seg) => {
    if (!seg) return seg;
    if (/^v\d+$/.test(seg)) return seg;
    if (/[\d@%]/.test(seg) || seg.length > 40) return ":id";
    return seg;
  });
  return parts.join("/") || "/";
}

function slotFor(list: Slot[], key: number): Slot {
  let s = list.at(-1);
  if (!s || s.key !== key) {
    s = { key, n: 0, err: 0, ms: [] };
    list.push(s);
    if (list.length > 60) list.splice(0, list.length - 60);
  }
  return s;
}

function pushSample(s: Slot, ms: number, isErr: boolean) {
  s.n++;
  if (isErr) s.err++;
  if (s.ms.length < SAMPLE_CAP) s.ms.push(ms);
}

/** 요청 하나 기록 (route()가 부른다). */
export function recordRequest(group: string, method: string, status: number, ms: number, nowMs = Date.now()): void {
  const st = metricsState();
  const k = `${group}\t${method}\t${status}`;
  st.requests.set(k, (st.requests.get(k) ?? 0) + 1);
  let h = st.durations.get(group);
  if (!h) {
    h = { counts: new Array(BUCKETS.length + 1).fill(0), sum: 0, count: 0 };
    st.durations.set(group, h);
  }
  const sec = ms / 1000;
  const i = BUCKETS.findIndex((b) => sec <= b);
  h.counts[i < 0 ? BUCKETS.length : i]++;
  h.sum += sec;
  h.count++;
  const isErr = status >= 500;
  pushSample(slotFor(st.seconds, Math.floor(nowMs / 1000)), ms, isErr);
  pushSample(slotFor(st.minutes, Math.floor(nowMs / 60_000)), ms, isErr);
}

/** 결제 시도 (toss·mock). */
export function incPayment(method: string, ok: boolean): void {
  const st = metricsState();
  const p = st.payments.get(method) ?? { attempts: 0, failures: 0 };
  p.attempts++;
  if (!ok) p.failures++;
  st.payments.set(method, p);
}

/** 주기 작업 소요 시간 (마지막 값). */
export function observeJob(name: string, ms: number): void {
  metricsState().jobs.set(name, ms / 1000);
}

export function incSlowQuery(): void {
  bumpSlowQuery();
}

/** 대기열에서 들여보낸 수. */
export function incQueueAdmitted(target: string, n: number): void {
  if (n <= 0) return;
  const st = metricsState();
  st.queueAdmitted.set(target, (st.queueAdmitted.get(target) ?? 0) + n);
}

export function resetMetrics(): void {
  resetMetricsState();
}

function p95(samples: number[]): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

/** 최근 60초: 오류율(5xx 비율)·p95(ms)·초당 요청 수. 서비스 모드 제안에 쓴다. */
export function recentWindow(now: Date): { error_rate: number; p95_ms: number; rps: number } {
  const from = Math.floor(now.getTime() / 1000) - 59;
  const slots = metricsState().seconds.filter((s) => s.key >= from);
  const n = slots.reduce((a, s) => a + s.n, 0);
  const err = slots.reduce((a, s) => a + s.err, 0);
  return {
    error_rate: n ? err / n : 0,
    p95_ms: p95(slots.flatMap((s) => s.ms)),
    rps: Math.round((n / 60) * 100) / 100,
  };
}

/** 직원 화면 그래프: 최근 60분, 1분 단위 (빈 분은 0). */
export function recentSeries(now: Date): { at: string; requests: number; errors: number; p95_ms: number }[] {
  const last = Math.floor(now.getTime() / 60_000);
  const byKey = new Map(metricsState().minutes.map((s) => [s.key, s]));
  const out = [];
  for (let k = last - 59; k <= last; k++) {
    const s = byKey.get(k);
    out.push({ at: new Date(k * 60_000).toISOString(), requests: s?.n ?? 0, errors: s?.err ?? 0, p95_ms: s ? p95(s.ms) : 0 });
  }
  return out;
}

// ── 내보내기 ──
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
const labels = (o: Record<string, string>) => `{${Object.entries(o).map(([k, v]) => `${k}="${esc(v)}"`).join(",")}}`;
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6))));

async function dbGauges(now: Date) {
  try {
    const since = new Date(now.getTime() - 60_000);
    const [playbacks, waiting, conns] = await Promise.all([
      db.playbackLease.count({ where: { beat_at: { gte: since } } }),
      db.queueTicket.groupBy({ by: ["target"], where: { status: "waiting" }, _count: { _all: true } }),
      db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database()`,
    ]);
    return {
      playbacks,
      waiting: waiting.map((w) => ({ target: w.target, n: w._count._all })),
      conns: Number(conns[0]?.n ?? 0),
      up: 1,
    };
  } catch {
    return { playbacks: 0, waiting: [] as { target: string; n: number }[], conns: 0, up: 0 };
  }
}

/** Prometheus 텍스트 형식. */
export async function renderMetrics(now: Date): Promise<string> {
  const st = metricsState();
  const g = await dbGauges(now);
  const out: string[] = [];
  const head = (name: string, type: string, help: string) => out.push(`# HELP ${PREFIX}${name} ${help}`, `# TYPE ${PREFIX}${name} ${type}`);

  head("http_requests_total", "counter", "HTTP requests by route group, method and status");
  for (const [k, v] of st.requests) {
    const [group, method, status] = k.split("\t");
    out.push(`${PREFIX}http_requests_total${labels({ group, method, status })} ${v}`);
  }

  head("http_request_duration_seconds", "histogram", "HTTP request duration by route group");
  for (const [group, h] of st.durations) {
    let acc = 0;
    BUCKETS.forEach((b, i) => {
      acc += h.counts[i];
      out.push(`${PREFIX}http_request_duration_seconds_bucket${labels({ group, le: String(b) })} ${acc}`);
    });
    acc += h.counts[BUCKETS.length];
    out.push(`${PREFIX}http_request_duration_seconds_bucket${labels({ group, le: "+Inf" })} ${acc}`);
    out.push(`${PREFIX}http_request_duration_seconds_sum${labels({ group })} ${num(h.sum)}`);
    out.push(`${PREFIX}http_request_duration_seconds_count${labels({ group })} ${h.count}`);
  }

  head("active_playbacks", "gauge", "Playback leases with a heartbeat in the last 60 seconds");
  out.push(`${PREFIX}active_playbacks ${g.playbacks}`);

  head("queue_waiting", "gauge", "Waiting queue tickets by target");
  for (const w of g.waiting) out.push(`${PREFIX}queue_waiting${labels({ target: w.target })} ${w.n}`);

  head("queue_admitted_total", "counter", "Queue tickets admitted by target");
  for (const [target, n] of st.queueAdmitted) out.push(`${PREFIX}queue_admitted_total${labels({ target })} ${n}`);

  head("payment_attempts_total", "counter", "Payment attempts by method");
  for (const [method, p] of st.payments) out.push(`${PREFIX}payment_attempts_total${labels({ method })} ${p.attempts}`);
  head("payment_failures_total", "counter", "Failed payment attempts by method");
  for (const [method, p] of st.payments) out.push(`${PREFIX}payment_failures_total${labels({ method })} ${p.failures}`);

  head("db_up", "gauge", "1 if the database answered while rendering metrics");
  out.push(`${PREFIX}db_up ${g.up}`);
  head("db_connections", "gauge", "Connections to the current database (pg_stat_activity)");
  out.push(`${PREFIX}db_connections ${g.conns}`);
  head("db_slow_queries_total", "counter", "Queries that took 500ms or more");
  out.push(`${PREFIX}db_slow_queries_total ${st.slowQueries}`);

  head("job_duration_seconds", "gauge", "Duration of the last run of each periodic job");
  for (const [job, s] of st.jobs) out.push(`${PREFIX}job_duration_seconds${labels({ job })} ${num(s)}`);

  return `${out.join("\n")}\n`;
}
