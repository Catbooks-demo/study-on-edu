/** 정답지 (로컬 전용): DB에 들어간 가상 데이터를 세어 설계값과 나란히 적는다. */
import { addDays, kstDate, kstDateTime } from "@/rules/time";
import { db } from "@/server/db";
import { type Ctx, type DayStats } from "./engine";
import {
  AGE_SHARE,
  ageBand,
  catalog,
  CATEGORY_CODES,
  CATEGORY_KO,
  CATEGORY_SHARE,
  certMultiplier,
  csatMultiplier,
  DEVICE_KO,
  DEVICE_SHARE,
  DEVICE_TYPES,
  DISCOUNT,
  DROP,
  EXAMS,
  FINAL_BY_CAT,
  FINAL_MEAN_TARGET,
  type DayPlan,
  type Model,
  PERSONAS,
  PLANTED,
  POST_CSAT,
  LATE_NOV_SALE,
  NEW_YEAR,
  PRODUCT_KINDS,
  PRODUCT_MIX,
  RATES,
  REFUND_RATE,
  SUBS,
  SYNTH_COUPON_PREFIX,
  SYNTH_DEVICE_PREFIX,
  SYNTH_DOMAIN,
  SYNTH_STAFF_EMAIL,
  toeicMultiplier,
} from "./model";
import { csvLine } from "./outdir";
import { DESIGN_SCALE, type TrafficMinute, trafficSummary } from "./traffic";

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const share = (a: number, b: number) => round3(a / Math.max(1, b));
const SYN = `%@${SYNTH_DOMAIN}`;

type Row = Record<string, unknown>;
const q = <T = Row>(sql: string, ...p: unknown[]) => db.$queryRawUnsafe<T[]>(sql, ...p);
const num = (v: unknown) => Number(v ?? 0);
/** 타임스탬프 열(UTC 값)과 견줄 문자열. */
const tsq = (d: Date) => d.toISOString().replace("Z", "");

export async function answerKey(model: Model, plans: DayPlan[], ctx: Ctx, cutoff: number, traffic: TrafficMinute[]) {
  const ws = model.windowStart;
  const U = `SELECT id FROM users WHERE email LIKE $1`;

  // ── 결제 ──
  const items = await q<{ kind: string; cat: string | null; n: bigint; list: bigint; paid: bigint }>(
    `SELECT oi.kind, cat.code AS cat, COUNT(*) AS n, SUM(oi.list_price) AS list, SUM(oi.paid_amount) AS paid
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       LEFT JOIN courses c ON c.id = oi.course_id LEFT JOIN categories cat ON cat.id = c.category_id
      WHERE o.user_id IN (${U}) AND o.paid_at IS NOT NULL GROUP BY oi.kind, cat.code`,
    SYN,
  );
  const bundleCat = new Map(catalog().bundles.map((b) => [b.code, b.cat]));
  const bundles = await q<{ code: string; n: bigint; paid: bigint }>(
    `SELECT b.code, COUNT(*) AS n, SUM(oi.paid_amount) AS paid FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN bundles b ON b.id = oi.bundle_id
      WHERE o.user_id IN (${U}) AND o.paid_at IS NOT NULL GROUP BY b.code`,
    SYN,
  );
  const subs = await q<{ plan: string; status: string; n: bigint }>(
    `SELECT p.code AS plan, s.status, COUNT(*) AS n FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.user_id IN (${U}) AND EXISTS (SELECT 1 FROM subscription_invoices i WHERE i.subscription_id = s.id AND i.status IN ('paid','refunded'))
      GROUP BY p.code, s.status`,
    SYN,
  );
  const singles = items.filter((r) => r.kind === "course").reduce((s, r) => s + num(r.n), 0);
  const bundleN = bundles.reduce((s, r) => s + num(r.n), 0);
  const monthly = subs.filter((r) => r.plan === "monthly").reduce((s, r) => s + num(r.n), 0);
  const yearly = subs.filter((r) => r.plan === "yearly").reduce((s, r) => s + num(r.n), 0);
  const kinds = { single: singles, bundle: bundleN, monthly, yearly };
  const totalKinds = singles + bundleN + monthly + yearly;
  const catAmount: Record<string, number> = Object.fromEntries(CATEGORY_CODES.map((c) => [c, 0]));
  const catCount: Record<string, number> = Object.fromEntries(CATEGORY_CODES.map((c) => [c, 0]));
  for (const r of items) {
    if (!r.cat) continue;
    catAmount[r.cat] += num(r.paid);
    catCount[r.cat] += num(r.n);
  }
  for (const r of bundles) {
    const c = bundleCat.get(r.code)!;
    catAmount[c] += num(r.paid);
    catCount[c] += num(r.n);
  }
  const amountTotal = Object.values(catAmount).reduce((a, b) => a + b, 0);
  const disc = await q<{ n: bigint; discounted: bigint; depth: number | null; coupon: bigint }>(
    `SELECT COUNT(*) AS n,
            COUNT(*) FILTER (WHERE discount_total + coupon_discount > 0) AS discounted,
            AVG((discount_total + coupon_discount)::float / NULLIF(list_total, 0)) FILTER (WHERE discount_total + coupon_discount > 0) AS depth,
            COUNT(*) FILTER (WHERE coupon_id IS NOT NULL) AS coupon
       FROM orders WHERE user_id IN (${U}) AND paid_at IS NOT NULL`,
    SYN,
  );
  const money = await q<{ kind: string; status: string; amount: bigint }>(
    `SELECT kind, status, SUM(amount) AS amount FROM payments
      WHERE (order_id IN (SELECT id FROM orders WHERE user_id IN (${U})) OR invoice_id IN (SELECT i.id FROM subscription_invoices i JOIN subscriptions s ON s.id = i.subscription_id WHERE s.user_id IN (${U})))
      GROUP BY kind, status`,
    SYN,
  );
  const methods = await q<{ method: string; n: bigint }>(
    `SELECT method, COUNT(*) AS n FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (${U})) OR invoice_id IN (SELECT i.id FROM subscription_invoices i JOIN subscriptions s ON s.id = i.subscription_id WHERE s.user_id IN (${U})) GROUP BY method`,
    SYN,
  );

  // ── 시험 달력: 주간 자격증(정처기·그 밖)·수능 결제 ──
  const jc = catalog().courses.filter((c) => c.group === "jeongcheogi").map((c) => c.code);
  const weekly = await q<{ week: Date; grp: string; n: bigint }>(
    `SELECT date_trunc('week', (o.paid_at + INTERVAL '9 hours')) AS week,
            CASE WHEN c.code = ANY($2::text[]) OR b.code = 'SO-PKG-0002' THEN 'CERT_jeongcheogi' WHEN cat.code = 'CERT' THEN 'CERT_other' ELSE cat.code END AS grp,
            COUNT(*) AS n
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       LEFT JOIN courses c ON c.id = oi.course_id LEFT JOIN categories cat ON cat.id = c.category_id LEFT JOIN bundles b ON b.id = oi.bundle_id
      WHERE o.user_id IN (${U}) AND o.paid_at IS NOT NULL GROUP BY 1, 2 ORDER BY 1`,
    SYN,
    jc,
  );
  const weeks = new Map<string, Record<string, number>>();
  for (const r of weekly) {
    const k = r.week.toISOString().slice(0, 10);
    const w = weeks.get(k) ?? {};
    w[r.grp ?? "PKG"] = num(r.n);
    weeks.set(k, w);
  }

  // ── 시청 ──
  const watch = await q<{ rows: bigint; users: bigint; added: bigint }>(
    `SELECT COUNT(*) AS rows, COUNT(DISTINCT user_id) AS users, SUM(added_sec) AS added FROM watch_events WHERE user_id IN (${U})`,
    SYN,
  );
  const perDay = await q<{ day: string; learners: bigint; rows: bigint }>(
    `SELECT to_char(created_at + INTERVAL '9 hours', 'YYYY-MM-DD') AS day, COUNT(DISTINCT user_id) AS learners, COUNT(*) AS rows
       FROM watch_events WHERE user_id IN (${U}) GROUP BY 1 ORDER BY 1`,
    SYN,
  );
  const sessions = [...ctx.stats.values()].reduce((s, d) => s + (d.followups.sessions ?? 0), 0);
  // 이탈 곡선: 유료 단과 수강권마다 연 가장 뒤 강 (강의 길이 대비 순서)
  const reach = await q<{ code: string; cat: string; n_lec: number; maxsort: number | null; ratio_done: number }>(
    `SELECT c.code, cat.code AS cat,
            (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id)::int AS n_lec,
            (SELECT MAX(l.sort) FROM lecture_progress p JOIN lectures l ON l.id = p.lecture_id WHERE p.user_id = e.user_id AND p.course_id = e.course_id AND p.watched_sec > 0) AS maxsort,
            COALESCE((SELECT SUM(l.duration_sec) FILTER (WHERE p.watched_sec >= 0.9 * l.duration_sec) FROM lecture_progress p JOIN lectures l ON l.id = p.lecture_id WHERE p.user_id = e.user_id AND p.course_id = e.course_id), 0)::float
              / NULLIF((SELECT SUM(l.duration_sec) FROM lectures l WHERE l.course_id = c.id), 0) AS ratio_done
       FROM enrollments e JOIN courses c ON c.id = e.course_id JOIN categories cat ON cat.id = c.category_id
      WHERE e.user_id IN (${U}) AND e.source = 'order' AND e.status <> 'refunded'`,
    SYN,
  );
  const curve = (rows: typeof reach) => {
    const n = Math.max(1, rows.length);
    const at = (k: (r: (typeof reach)[number]) => number) => share(rows.filter((r) => (r.maxsort ?? 0) >= k(r)).length, n);
    return {
      enrollments: rows.length,
      lecture1: at(() => 1),
      lecture2: at(() => 2),
      lecture3: at(() => 3),
      last_lecture: at((r) => r.n_lec),
      completed_80pct: share(rows.filter((r) => r.ratio_done >= 0.8).length, n),
    };
  };
  const enrollAll = await q<{ source: string; status: string; n: bigint }>(
    `SELECT source, status, COUNT(*) AS n FROM enrollments WHERE user_id IN (${U}) GROUP BY source, status`,
    SYN,
  );
  const certs = num((await q<{ n: bigint }>(`SELECT COUNT(*) AS n FROM certificates WHERE user_id IN (${U})`, SYN))[0].n);

  // ── 구독 ──
  const subEvents = await q<{ failed: bigint; recovered: bigint; expired: bigint; paused: bigint; cancel: bigint; renewed: bigint }>(
    `SELECT
       (SELECT COUNT(DISTINCT i.subscription_id) FROM payments p JOIN subscription_invoices i ON i.id = p.invoice_id JOIN subscriptions s ON s.id = i.subscription_id WHERE s.user_id IN (${U}) AND p.status = 'failed') AS failed,
       (SELECT COUNT(DISTINCT i.id) FROM subscription_invoices i JOIN subscriptions s ON s.id = i.subscription_id WHERE s.user_id IN (${U}) AND i.status = 'paid' AND EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.status = 'failed')) AS recovered,
       (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id IN (${U}) AND s.status = 'expired' AND s.failure_count > 0) AS expired,
       (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id IN (${U}) AND jsonb_array_length(s.pauses) > 0) AS paused,
       (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id IN (${U}) AND (s.cancel_at_period_end OR (s.status = 'cancelled' AND NOT EXISTS (SELECT 1 FROM refunds r JOIN subscription_invoices i ON i.id = r.invoice_id WHERE i.subscription_id = s.id)))) AS cancel,
       (SELECT COUNT(*) FROM subscription_invoices i JOIN subscriptions s ON s.id = i.subscription_id WHERE s.user_id IN (${U}) AND i.status = 'paid' AND i.period_start > s.created_at + INTERVAL '1 day') AS renewed`,
    SYN,
  );

  // ── 환불 ──
  const refunds = await q<{ product: string; cat: string | null; status: string; kind: string | null; n: bigint; amount: bigint }>(
    `SELECT CASE WHEN r.invoice_id IS NOT NULL THEN p.code WHEN oi.kind = 'bundle' THEN 'bundle' ELSE 'single' END AS product,
            COALESCE(cat.code, bc.cat) AS cat, r.status, r.basis->>'kind' AS kind, COUNT(*) AS n, SUM(r.amount) AS amount
       FROM refunds r
       LEFT JOIN order_items oi ON oi.id = r.order_item_id
       LEFT JOIN courses c ON c.id = oi.course_id LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN (SELECT bcx.bundle_id, MIN(ct.code) AS cat FROM bundle_courses bcx JOIN courses cx ON cx.id = bcx.course_id JOIN categories ct ON ct.id = cx.category_id WHERE bcx.sort = 0 GROUP BY bcx.bundle_id) bc ON bc.bundle_id = oi.bundle_id
       LEFT JOIN subscription_invoices i ON i.id = r.invoice_id LEFT JOIN subscriptions s ON s.id = i.subscription_id LEFT JOIN plans p ON p.id = s.plan_id
      WHERE r.user_id IN (${U}) GROUP BY 1, 2, 3, 4`,
    SYN,
  );
  const refundBy = (f: (r: (typeof refunds)[number]) => boolean) => refunds.filter(f).reduce((s, r) => s + num(r.n), 0);

  // ── 소통 ──
  const qa = await q<{ questions: bigint; by_instructor: bigint; by_staff: bigint; unanswered: bigint; reviews: bigint; avg_rating: number | null }>(
    `SELECT (SELECT COUNT(*) FROM questions WHERE user_id IN (${U})) AS questions,
            (SELECT COUNT(DISTINCT a.question_id) FROM answers a JOIN questions qq ON qq.id = a.question_id WHERE qq.user_id IN (${U}) AND a.author_kind = 'instructor') AS by_instructor,
            (SELECT COUNT(DISTINCT a.question_id) FROM answers a JOIN questions qq ON qq.id = a.question_id WHERE qq.user_id IN (${U}) AND a.author_kind = 'staff') AS by_staff,
            (SELECT COUNT(*) FROM questions WHERE user_id IN (${U}) AND answered_at IS NULL) AS unanswered,
            (SELECT COUNT(*) FROM reviews WHERE user_id IN (${U})) AS reviews,
            (SELECT AVG(rating)::float FROM reviews WHERE user_id IN (${U})) AS avg_rating`,
    SYN,
  );
  const inquiries = await q<{ category: string; status: string; n: bigint }>(`SELECT category, status, COUNT(*) AS n FROM inquiries WHERE user_id IN (${U}) GROUP BY 1, 2`, SYN);
  const enrollTotal = enrollAll.reduce((s, r) => s + num(r.n), 0);

  // ── 라이브 ──
  const live = await q<{ title: string; starts_at: Date; seats: bigint; entered: bigint; chats: bigint; synthetic: boolean }>(
    `SELECT ls.title, ls.starts_at,
            (SELECT COUNT(*) FROM live_seats st WHERE st.session_id = ls.id AND st.user_id IN (${U})) AS seats,
            (SELECT COUNT(*) FROM live_seats st WHERE st.session_id = ls.id AND st.user_id IN (${U}) AND st.entered_at IS NOT NULL) AS entered,
            (SELECT COUNT(*) FROM live_chats ch WHERE ch.session_id = ls.id AND ch.user_id IN (${U})) AS chats,
            EXISTS (SELECT 1 FROM audit_logs a WHERE a.actor = $2 AND a.action = 'synth.live.create' AND a.target = 'live:' || ls.id) AS synthetic
       FROM live_sessions ls ORDER BY ls.starts_at`,
    SYN,
    `staff:${ctx.staffId}`,
  );

  // ── 심어 둔 사건 ──
  const certIds = [...ctx.courses.values()].filter((c) => c.cat === "CERT").map((c) => c.id);
  const sp = PLANTED.certSpike;
  const certRows = async (d: string) =>
    num(
      (
        await q<{ n: bigint }>(
          `SELECT COUNT(*) AS n FROM watch_events WHERE user_id IN (${U}) AND course_id = ANY($2::text[]) AND created_at >= CAST($3 AS timestamp(3)) AND created_at < CAST($4 AS timestamp(3))`,
          SYN,
          certIds,
          tsq(kstDateTime(d, sp.fromHour)),
          tsq(kstDateTime(d, sp.toHour)),
        )
      )[0].n,
    );
  const spikeIn = sp.date >= ws && sp.date <= model.windowEnd;
  const spikeRows = spikeIn ? await certRows(sp.date) : null;
  const before: number[] = [];
  if (spikeIn) for (let w = 1; w <= 4; w++) if (addDays(sp.date, -7 * w) >= ws) before.push(await certRows(addDays(sp.date, -7 * w)));
  const f = PLANTED.fault;
  const faultIn = f.date >= ws && f.date <= model.windowEnd;
  const faultInq = faultIn
    ? num(
        (
          await q<{ n: bigint }>(
            `SELECT COUNT(*) AS n FROM inquiries WHERE user_id IN (${U}) AND category = 'player' AND created_at >= CAST($2 AS timestamp(3)) AND created_at < CAST($3 AS timestamp(3))`,
            SYN,
            tsq(kstDateTime(f.date, 9)),
            tsq(kstDateTime(f.date, 11)),
          )
        )[0].n,
      )
    : null;
  const normalInqPerHour = num(
    (await q<{ n: bigint }>(`SELECT COUNT(*) AS n FROM inquiries WHERE user_id IN (${U}) AND (created_at < CAST($2 AS timestamp(3)) OR created_at >= CAST($3 AS timestamp(3)))`, SYN, tsq(kstDateTime(f.date, 9)), tsq(kstDateTime(f.date, 11))))[0].n,
  ) / Math.max(1, (cutoff - kstDateTime(ws).getTime()) / 3_600_000);
  const sorryUsed = num((await q<{ n: bigint }>(`SELECT COUNT(*) AS n FROM orders o JOIN coupons c ON c.id = o.coupon_id WHERE c.code = $1 AND o.paid_at IS NOT NULL`, f.compensation.code))[0].n);

  const followupsTotal: Record<string, number> = {};
  for (const s of ctx.stats.values()) for (const [k, v] of Object.entries(s.followups)) followupsTotal[k] = (followupsTotal[k] ?? 0) + v;
  const firstWeek = perDay.slice(0, 7);
  const lastWeek = perDay.slice(-8, -1);
  const avg = (rows: typeof perDay) => Math.round(rows.reduce((s, r) => s + num(r.learners), 0) / Math.max(1, rows.length));

  const ages = new Map<string, number>();
  for (const m of model.members) ages.set(ageBand(m), (ages.get(ageBand(m)) ?? 0) + 1);
  const devCount = DEVICE_TYPES.map((d) => model.members.reduce((s, m) => s + m.devices.filter((x) => x === d).length, 0));
  const devTotal = devCount.reduce((a, b) => a + b, 0);

  return {
    설명:
      "스터디온에듀 가상 이용자 정답지 (로컬 전용, 저장소·DB·공유 금지). AXcellent 연결 시험에서 받은 데이터가 이 값과 맞는지 본다. 기간은 학습자가 결제하거나 강의를 본 날(KST) 기준.",
    meta: {
      generated_at: new Date().toISOString(),
      seed: model.seed,
      window: { start: ws, end: model.windowEnd, cutoff: new Date(cutoff).toISOString(), days: plans.length, basis: "결제하거나 강의를 본 날(KST)" },
      marker: {
        email_domain: `@${SYNTH_DOMAIN}`,
        members: `m00001@${SYNTH_DOMAIN} ~ (회원 번호 = 가입 순서). 로그인할 수 없는 비밀번호 해시`,
        staff: `${SYNTH_STAFF_EMAIL} (비활성, 환불 승인·거절, 문의 답변, 질문 답변 일부, 지난 라이브 생성 기록)`,
        coupons: `${SYNTH_COUPON_PREFIX}* (할인 20·25·30%, 보상 ${f.compensation.code})`,
        devices: `기기 키 ${SYNTH_DEVICE_PREFIX}m00001-1 …`,
        live_sessions: "가상 직원의 작업 기록(audit_logs action=synth.live.create)이 있는 라이브",
        payments: "모두 모의 결제(method=mock)",
      },
      rules_kept: "스터디온에듀 현재 규칙 그대로: 결제 30분 기한, 7일·진도 5% 전액 환불, 진도·기간 큰 값 공제, 강 90% 완료·강의 80% 수료, 후기는 진도 40%부터, 기기 2대, 구독 갱신 24시간 전·재시도 +1·+3·+5일.",
      watch_rows: "watch_events는 30초 하트비트마다가 아니라 (세션, 강) 조각마다 한 줄. 생성기 프로세스만 하트비트 주기를 1800초로 두고 서버 heartbeat()를 그대로 부른다.",
    },
    members: {
      total: model.members.length,
      joined_in_window: model.members.filter((m) => m.joinedInWindow).length,
      by_persona: PERSONAS.map((p, i) => ({ code: p.code, name: p.name, design_share: p.share, members: model.members.filter((m) => m.persona === i).length })),
      age_bands: AGE_SHARE.map(([k, v]) => ({ band: k, design: v, actual: share(ages.get(k) ?? 0, model.members.length) })),
      devices: DEVICE_TYPES.map((d, j) => ({ type: DEVICE_KO[d], design: DEVICE_SHARE[j], actual: share(devCount[j], devTotal) })),
      two_devices: share(model.members.filter((m) => m.devices.length === 2).length, model.members.length),
    },
    purchases: {
      planned: plans.reduce((s, p) => s + p.intents.filter((i) => i.t <= cutoff).length, 0),
      inserted: totalKinds,
      lost: [...ctx.stats.values()].reduce((s, d: DayStats) => s + d.lost, 0),
      by_kind: PRODUCT_KINDS.map((k, j) => ({ kind: k, design_share: PRODUCT_MIX[j] / 100, count: kinds[k], share: share(kinds[k], totalKinds) })),
      by_category: CATEGORY_CODES.map((c) => ({ code: c, name: CATEGORY_KO[c], design_amount_share: CATEGORY_SHARE[c] / 100, count: catCount[c], amount: catAmount[c], amount_share: share(catAmount[c], amountTotal) })),
      discount: {
        design: { share: DISCOUNT.share, depth: DISCOUNT.depth, sale_week_share: DISCOUNT.saleWeekShare },
        orders: num(disc[0].n),
        discounted_share: share(num(disc[0].discounted), num(disc[0].n)),
        avg_depth_of_discounted: round3(disc[0].depth ?? 0),
        with_coupon: num(disc[0].coupon),
      },
      payments: money.map((m) => ({ kind: m.kind, status: m.status, amount: num(m.amount) })),
      methods: Object.fromEntries(methods.map((m) => [m.method, num(m.n)])),
    },
    by_day: plans.map((p) => {
      const s = ctx.stats.get(p.date);
      return {
        date: p.date,
        dow_index: p.dowIndex,
        multipliers: Object.fromEntries(Object.entries(p.multipliers).map(([k, v]) => [k, round3(v)])),
        discount_share: p.discountShare,
        expected: Math.round(p.expected * 10) / 10,
        planned: s?.planned ?? 0,
        inserted: s?.inserted ?? 0,
        lost: s?.lost ?? 0,
        by_kind: s?.byKind ?? {},
        by_cat: s?.byCat ?? {},
        followups: s?.followups ?? {},
      };
    }),
    exam_calendar: {
      설명: "자격증: 정보처리기사 3회 실기 10/24~11/13(D-30부터 최고 ×1.9, 시험 뒤 6일 ×0.6), 공인중개사 10/31(최고 ×2.1). 분야 전체 배수는 둘의 반반. 수능 11/19 D-30부터 ×1.5까지. 토익 D-14 ×1.3(토익 유형). 추석 9/24~27 자격증·수능 밖 ×0.85.",
      exams: EXAMS,
      after_csat: POST_CSAT,
      late_nov_sale: LATE_NOV_SALE,
      new_year: NEW_YEAR,
      daily_multipliers: plans.map((p) => ({ date: p.date, cert: round3(certMultiplier(p.date)), csat: round3(csatMultiplier(p.date)), toeic: toeicMultiplier(p.date) })),
      weekly_purchases_by_group: [...weeks.entries()].map(([week, v]) => ({ week_start_kst: week, ...v })),
      note_realtor: "시드에 공인중개사 강의가 없어 공인중개사 준비 유형은 자격증의 정처기 밖 강의(컴활·SQLD·한국사)와 패키지 없는 단과를 산다. 10/31 파도는 CERT_other와 공인중개사 유형에서 보인다.",
    },
    watching: {
      sessions,
      watch_event_rows: num(watch[0].rows),
      rows_per_session: share(num(watch[0].rows), sessions),
      learners: num(watch[0].users),
      watched_hours: Math.round(num(watch[0].added) / 360) / 10,
      learners_per_day: perDay.map((r) => ({ date: r.day, learners: num(r.learners), rows: num(r.rows) })),
      enrollments: Object.fromEntries(enrollAll.map((r) => [`${r.source}:${r.status}`, num(r.n)])),
      certificates: certs,
      drop_off_paid_single: {
        design: { lecture1: DROP.first, lecture2: DROP.second, lecture3: DROP.third, last_mean: FINAL_MEAN_TARGET, last_by_category: FINAL_BY_CAT },
        all: curve(reach),
        by_category: Object.fromEntries(CATEGORY_CODES.map((c) => [c, curve(reach.filter((r) => r.cat === c))])),
        note: "결과값은 기간 안에 산 수강권만 센다. 늦게 산 수강권은 아직 다 보지 못해 마지막 강·완강이 설계보다 낮다(시작 구간 효과와 같은 이유).",
      },
    },
    start_effect: {
      name: "시작 구간 효과",
      설명:
        "기간 시작 전에 산 수강권·구독은 만들지 않았다. 그래서 처음 몇 주는 진도가 0에서 시작한 사람만 있어 하루 학습자·완강·수료증·구독 갱신이 실제보다 적고, 기간이 갈수록 늘어난다. 분석 확인 때는 앞 4주를 빼고, 완강률은 기간 앞쪽에 산 수강권으로만 본다.",
      learners_per_day_first_week: avg(firstWeek),
      learners_per_day_last_week: avg(lastWeek),
      design_steady_state_learners_per_day: DESIGN_SCALE.learnersPerDay,
      enrollments_before_window: 0,
      exclude_until: addDays(ws, 28),
    },
    subscriptions: {
      design: SUBS,
      started: { monthly, yearly, yearly_share: share(yearly, monthly + yearly) },
      statuses: subs.map((s) => ({ plan: s.plan, status: s.status, n: num(s.n) })),
      payment_failed_subs: num(subEvents[0].failed),
      recovered_invoices: num(subEvents[0].recovered),
      expired_after_failures: num(subEvents[0].expired),
      paused: num(subEvents[0].paused),
      cancel_scheduled_or_cancelled: num(subEvents[0].cancel),
      renewed_invoices: num(subEvents[0].renewed),
      note: "연 구독 갱신(40%)은 1년 뒤라 기간 안에는 없다. 해지 예약만 보인다.",
    },
    refunds: {
      design: { rate: REFUND_RATE, skew: "어학·직무(비즈니스) 쪽으로", early_full: RATES.refundEarly },
      by_product: ["single", "bundle", "monthly", "yearly"].map((k) => ({
        product: k,
        requested: refundBy((r) => r.product === k),
        done: refundBy((r) => r.product === k && r.status === "done"),
        rejected: refundBy((r) => r.product === k && r.status === "rejected"),
        rate_of_purchases: share(refundBy((r) => r.product === k), kinds[k as keyof typeof kinds]),
      })),
      by_category: CATEGORY_CODES.map((c) => ({ code: c, requested: refundBy((r) => r.cat === c), rate: share(refundBy((r) => r.cat === c), catCount[c]) })),
      full_vs_prorated: { full: refundBy((r) => r.kind === "full"), prorated: refundBy((r) => r.kind === "prorated") },
      amount_done: refunds.filter((r) => r.status === "done").reduce((s, r) => s + num(r.amount), 0),
    },
    communication: {
      design: { question: RATES.question, question_dev_data: RATES.questionDevData, review: RATES.review, review_completed: RATES.reviewCompleted, inquiry: RATES.inquiry },
      questions: num(qa[0].questions),
      answered_by_instructor: num(qa[0].by_instructor),
      answered_by_staff: num(qa[0].by_staff),
      unanswered: num(qa[0].unanswered),
      reviews: num(qa[0].reviews),
      review_rate_of_enrollments: share(num(qa[0].reviews), enrollTotal),
      avg_rating: round3(qa[0].avg_rating ?? 0),
      inquiries: inquiries.map((r) => ({ category: r.category, status: r.status, n: num(r.n) })),
    },
    live: live
      .filter((l) => num(l.seats) > 0 || l.synthetic)
      .map((l) => ({ title: l.title, starts_at_kst: kstDate(l.starts_at), synthetic_session: l.synthetic, seats: num(l.seats), entered: num(l.entered), chats: num(l.chats) })),
    planted: {
      cert_spike: {
        ...sp,
        in_window: spikeIn,
        rewatch_sessions: ctx.extra.spikeRewatch,
        cert_watch_rows_18_21: spikeRows,
        same_hours_previous_saturdays: before,
        ratio: spikeRows !== null && before.length ? round3(spikeRows / Math.max(1, before.reduce((a, b) => a + b, 0) / before.length)) : null,
        구분: "수요(대기열로 처리). 오류율은 평소와 같다.",
      },
      fault: {
        ...f,
        in_window: faultIn,
        broken_sessions: ctx.extra.faultSessions,
        affected_members: ctx.extra.faultUsers.length,
        inquiries_9_to_11: faultInq,
        normal_inquiries_per_hour: round3(normalInqPerHour),
        compensation_sent_to: ctx.extra.sorry.length,
        compensation_used_orders: sorryUsed,
        구분: "장애. 시청은 시작(재생 소유권·기기 사용 시각)됐는데 그 조각의 watch_events·진도가 없다.",
      },
      csat_live: { ...PLANTED.csatLive, note: "11/19 저녁 입장 폭주는 매일 모드에서 생긴다. 예약은 되채우기 기간 끝(11/12~)부터 들어간다." },
    },
    traffic: {
      file: "traffic.jsonl (분 단위 계획값, 설계 규모: 하루 학습자 약 4,500명)",
      scale: DESIGN_SCALE,
      summary: trafficSummary(traffic),
      metrics_tables: "M7 지표 표가 아직 없어 DB에는 쓰지 않았다 (--metrics는 자리만, TODO).",
    },
    followups_total: followupsTotal,
    checks: [
      ["연결", "결제·환불·구독·수강권이 빠짐없이 들어옴(스터디온에듀 건수 = 받은 건수)", "/api/v1 커서로 끝까지 받기"],
      ["연결", "서버 지표가 들어오고, 10/31 저녁과 11/2 오전이 다르게 보임", "/metrics 요약 (지금은 traffic.jsonl)"],
      ["데이터", "자격증 결제가 10월 말에 오르고 시험 뒤 떨어짐(공인중개사·정보처리기사 각각)", "exam_calendar.weekly_purchases_by_group"],
      ["데이터", "완강률은 자격증·수능이 높고 디자인이 낮음, 이탈은 1~3강에 몰림", "watching.drop_off_paid_single"],
      ["총괄", "10/31 저녁 접속 폭주는 수요(대기열로 처리), 11/2 오전 오류는 장애로 구분", "planted"],
      ["인프라", "11/2 장애 시작·끝 시각과 영향받은 시청 수를 맞힘", "planted.fault"],
      ["고객지원", "11/2 오류 문의를 같은 원인으로 묶어 일괄 안내, 보상 쿠폰 확인", "planted.fault"],
      ["재무", "진도 비례 환불이 규칙대로 계산되고, 강사 정산에서 환불이 차감됨", "refunds"],
      ["마케팅", "수능 다음 날부터 자격증·어학 캠페인 제안, 단 라이브 폭주 시간은 피해서", "exam_calendar.after_csat"],
    ].map(([dept, answer, where]) => ({ dept, answer, where })),
  };
}

export function personaCsv(model: Model): string {
  const head = ["member_no", "email", "persona", "persona_name", "joined_at", "joined_in_window", "gender", "birth_year", "age_band", "orders_per_year", "completion", "devices", ...CATEGORY_CODES.map((c) => `w_${c}`)];
  const lines = [csvLine(head)];
  for (const m of model.members) {
    lines.push(
      csvLine([
        m.index + 1,
        m.email,
        PERSONAS[m.persona].code,
        PERSONAS[m.persona].name,
        new Date(m.joinedAt).toISOString(),
        m.joinedInWindow,
        m.gender,
        m.birthYear,
        ageBand(m),
        round3(m.ordersPerYear),
        round3(m.completion),
        m.devices.join("+"),
        ...m.catW.map(round3),
      ]),
    );
  }
  return `﻿${lines.join("\n")}\n`;
}
