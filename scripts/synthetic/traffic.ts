/**
 * 분 단위 서버 지표 계획 (traffic.jsonl). DB를 건드리지 않는다.
 *
 * M7(지표 표)이 아직 없어서, 설계가 정한 모양(평상시 하루 학습자 약 4,500명 규모)의 접속·하트비트·오류를 분마다
 * 계획값으로 적는다. 넣은 행에서 센 값이 아니라 "서버 지표가 이렇게 보여야 한다"는 정답이다.
 * TODO(M7): 지표 표가 생기면 --metrics로 이 값을 그 표에 넣는다.
 */
import { addDays, diffDays, kstDateTime } from "../../src/rules/time";
import {
  csatMultiplier,
  certMultiplier,
  dowIndex,
  faultWindow,
  HRS,
  isChuseok,
  PLANTED,
  CATEGORY_SHARE,
} from "./model";
import { Rng } from "./rng";

/** 설계의 평상시 규모: 하루 학습자 4,500명 × 1.2세션 × 32분. */
export const DESIGN_SCALE = { learnersPerDay: 4_500, sessionsPerLearner: 1.2, sessionMin: 32, pageViewsPerPlayMin: 1.5, baseErrorRate: 0.002 };

export interface TrafficMinute {
  ts: string; // UTC ISO
  kst: string; // YYYY-MM-DD HH:mm
  concurrent_playback: number;
  heartbeats: number;
  progress_save_errors: number;
  error_rate: number;
  page_views: number;
  page_views_cert: number;
  page_views_exam: number;
  live_viewers: number;
  queue_on: boolean;
  tags: string[];
}

const hourMix = (() => {
  const w = Array.from({ length: 24 }, (_, h) => 0.24 * HRS.teen[h] + 0.31 * HRS.twenties[h] + 0.38 * HRS.thirties[h] + 0.07 * HRS.senior[h]);
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((v) => (v / s) * 24); // 평균 1
})();

/** 하루 분 단위 계획 (한국 날짜). seed로 작은 흔들림. */
export function trafficDay(seed: number, date: string): TrafficMinute[] {
  const rng = new Rng(`${seed}:traffic:${date}`);
  const avgConc = (DESIGN_SCALE.learnersPerDay * DESIGN_SCALE.sessionsPerLearner * DESIGN_SCALE.sessionMin) / 1440;
  const dayF = dowIndex(date) * (isChuseok(date) ? 0.85 : 1);
  const certF = certMultiplier(date);
  const examF = csatMultiplier(date);
  const fw = faultWindow();
  const out: TrafficMinute[] = [];
  const start = kstDateTime(date).getTime();
  for (let i = 0; i < 1440; i++) {
    const t = start + i * 60_000;
    const h = Math.floor(i / 60);
    // 시간 사이를 부드럽게
    const frac = (i % 60) / 60;
    const shape = hourMix[h] * (1 - frac) + hourMix[(h + 1) % 24] * frac;
    const noise = 0.92 + rng.random() * 0.16;
    const conc = avgConc * shape * dayF * noise;
    let pv = conc * DESIGN_SCALE.pageViewsPerPlayMin;
    let pvCert = pv * (CATEGORY_SHARE.CERT / 100) * certF;
    let pvExam = pv * (CATEGORY_SHARE.EXAM / 100) * examF;
    const tags: string[] = [];
    let queue = false;
    let live = 0;
    if (date === PLANTED.certSpike.date && PLANTED.certSpike.hourFactors[h]) {
      const f = PLANTED.certSpike.hourFactors[h];
      pv += pvCert * (f - 1);
      pvCert *= f;
      queue = true;
      tags.push("cert_spike");
    }
    if (date === PLANTED.csatLive.date && PLANTED.csatLive.pageFactors[h]) {
      const f = PLANTED.csatLive.pageFactors[h];
      pv += pvExam * (f - 1);
      pvExam *= f;
      if (h >= PLANTED.csatLive.hour && h < PLANTED.csatLive.hour + PLANTED.csatLive.minutes / 60) live = Math.round(avgConc * 0.6 * f * noise);
      queue = h >= PLANTED.csatLive.hour && h < PLANTED.csatLive.hour + 1;
      tags.push("csat_live");
    }
    const playing = conc + (queue ? conc * 0.5 : 0);
    const heartbeats = Math.round(playing * 2); // 30초마다
    let errRate = DESIGN_SCALE.baseErrorRate * (0.5 + rng.random());
    if (t >= fw.from && t < fw.to) {
      errRate = PLANTED.fault.errorRate;
      tags.push("fault_progress_save");
    }
    const hh = String(h).padStart(2, "0");
    const mm = String(i % 60).padStart(2, "0");
    out.push({
      ts: new Date(t).toISOString(),
      kst: `${date} ${hh}:${mm}`,
      concurrent_playback: Math.round(playing),
      heartbeats,
      progress_save_errors: Math.round(heartbeats * errRate),
      error_rate: Math.round(errRate * 10000) / 10000,
      page_views: Math.round(pv),
      page_views_cert: Math.round(pvCert),
      page_views_exam: Math.round(pvExam),
      live_viewers: live,
      queue_on: queue,
      tags,
    });
  }
  return out;
}

/** 여러 날 (from ~ to, 한국 날짜, 양 끝 포함). untilMs보다 늦은 분은 뺀다. */
export function trafficRange(seed: number, from: string, to: string, untilMs = Infinity): TrafficMinute[] {
  const out: TrafficMinute[] = [];
  for (let k = 0; k <= diffDays(from, to); k++) for (const m of trafficDay(seed, addDays(from, k))) if (Date.parse(m.ts) <= untilMs) out.push(m);
  return out;
}

/** 정답지용 요약: 시간별 평균, 심은 사건 시간대의 배수. */
export function trafficSummary(minutes: TrafficMinute[]) {
  const sum = (f: (m: TrafficMinute) => boolean, k: keyof TrafficMinute) => minutes.filter(f).reduce((s, m) => s + (m[k] as number), 0);
  const ofHour = (date: string, h: number) => (m: TrafficMinute) => m.kst.startsWith(`${date} ${String(h).padStart(2, "0")}`);
  const spikeDate = PLANTED.certSpike.date;
  const lastSat = addDays(spikeDate, -7);
  const certRatio = [18, 19, 20].map((h) => ({
    hour: h,
    cert_page_views: sum(ofHour(spikeDate, h), "page_views_cert"),
    same_hour_week_before: sum(ofHour(lastSat, h), "page_views_cert"),
  }));
  const fault = minutes.filter((m) => m.tags.includes("fault_progress_save"));
  return {
    minutes: minutes.length,
    cert_spike_by_hour: certRatio.map((r) => ({ ...r, ratio: r.same_hour_week_before ? Math.round((r.cert_page_views / r.same_hour_week_before) * 100) / 100 : null })),
    fault_minutes: fault.length,
    fault_first: fault[0]?.kst ?? null,
    fault_last: fault.at(-1)?.kst ?? null,
    fault_errors: fault.reduce((s, m) => s + m.progress_save_errors, 0),
  };
}
