import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../prisma/seed-lib";
import { addDays, kstDate, kstDateTime } from "@/rules/time";
import { addToCart } from "@/server/cart";
import { db } from "@/server/db";
import { createOrder } from "@/server/orders";
import { mockPay } from "@/server/payments";
import { runBackfill } from "../scripts/synthetic/backfill";
import { runDaily } from "../scripts/synthetic/daily";
import { countSynthetic, deleteSynthetic } from "../scripts/synthetic/engine";
import { SYNTH_COUPON_PREFIX, SYNTH_DEVICE_PREFIX, SYNTH_DOMAIN, SYNTH_STAFF_EMAIL, WINDOW_DAYS } from "../scripts/synthetic/model";
import { FILES, REPO_ROOT } from "../scripts/synthetic/outdir";
import type { DailyState } from "../scripts/synthetic/state";
import { resetDb } from "./helpers/db";
import { makeUser } from "./helpers/fixtures";

// 작은 크기(회원 1,500명)로 되채우기 → 매일 모드 두 차례 → 가상 데이터 지우기까지 실제 서버 함수로 돌린다.
const out = mkdtempSync(path.join(tmpdir(), "studyon-synth-"));
const now = new Date();
const today = kstDate(now);
const start = kstDateTime(addDays(today, -WINDOW_DAYS));
const synthUser = { user: { email: { endsWith: `@${SYNTH_DOMAIN}` } } };
const quiet = () => {};

describe("가상 이용자 (DB)", () => {
  beforeAll(async () => {
    delete process.env.TOSS_CLIENT_KEY;
    delete process.env.TOSS_SECRET_KEY;
    await resetDb();
    await runSeed(db, { now });
    await runBackfill({ seed: 11, out, replace: false, force: true, members: 1500, now, log: quiet });
  }, 1_500_000);

  it("결제가 들어가고, 결제·시청이 기간 시작 전이거나 지금보다 늦은 것은 없다", async () => {
    const orders = await db.order.findMany({ where: synthUser, select: { created_at: true, paid_at: true, code: true } });
    expect(orders.length).toBeGreaterThan(100);
    for (const o of orders) {
      expect(o.created_at.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(o.created_at.getTime()).toBeLessThanOrEqual(now.getTime());
      // 주문번호의 날짜 = 결제한 날(한국 시간)
      expect(o.code.slice(2, 8)).toBe(kstDate(o.created_at).replace(/-/g, "").slice(2));
    }
    const range = { lt: start };
    expect(await db.watchEvent.count({ where: { ...synthUser, created_at: range } })).toBe(0);
    expect(await db.enrollment.count({ where: { ...synthUser, created_at: range } })).toBe(0);
    expect(await db.payment.count({ where: { order: synthUser, created_at: range } })).toBe(0);
    expect(await db.watchEvent.count({ where: { ...synthUser, created_at: { gt: now } } })).toBe(0);
    expect(await db.subscription.count({ where: synthUser })).toBeGreaterThan(0);
  });

  it("시청: 조각마다 watch_events 한 줄, 진도의 본 초 = 더해진 초의 합", async () => {
    const rows = await db.watchEvent.count({ where: synthUser });
    expect(rows).toBeGreaterThan(200);
    const progress = await db.lectureProgress.findMany({ where: synthUser, select: { user_id: true, lecture_id: true, watched_sec: true } });
    const added = await db.watchEvent.groupBy({ by: ["user_id", "lecture_id"], where: synthUser, _sum: { added_sec: true } });
    const byKey = new Map(added.map((a) => [`${a.user_id}|${a.lecture_id}`, a._sum.added_sec ?? 0]));
    for (const p of progress) expect(p.watched_sec, `${p.user_id}|${p.lecture_id}`).toBe(byKey.get(`${p.user_id}|${p.lecture_id}`) ?? 0);
    // 대부분의 조각은 새 초를 더한다 (30초 하트비트를 다 넣지 않고 조각마다 한 번)
    const zero = await db.watchEvent.count({ where: { ...synthUser, added_sec: 0 } });
    expect(zero / rows).toBeLessThan(0.2);
    const devices = await db.device.groupBy({ by: ["user_id"], where: { ...synthUser, revoked_at: null }, _count: { _all: true } });
    for (const d of devices) expect(d._count._all).toBeLessThanOrEqual(2);
    expect(await db.device.count({ where: { ...synthUser, NOT: { device_key: { startsWith: SYNTH_DEVICE_PREFIX } } } })).toBe(0);
  });

  it("환불·결제는 스터디온에듀 규칙대로, 결제는 모두 모의 결제", async () => {
    const pays = await db.payment.findMany({ where: { OR: [{ order: synthUser }, { invoice: { subscription: synthUser } }] }, select: { method: true } });
    expect(pays.length).toBeGreaterThan(0);
    for (const p of pays) expect(p.method).toBe("mock");
    const refunds = await db.refund.findMany({ where: { ...synthUser, status: "done" }, include: { order_item: true, payments: true } });
    for (const r of refunds) {
      expect(r.amount).toBe(r.calc_amount);
      expect(r.payments.filter((p) => p.status === "approved").reduce((s, p) => s + p.amount, 0)).toBe(r.amount);
      if (r.order_item) expect(r.order_item.refunded_amount).toBe(r.amount);
    }
    const orders = await db.order.findMany({ where: { ...synthUser, paid_at: { not: null } }, include: { items: true } });
    for (const o of orders) {
      expect(o.items.reduce((s, it) => s + it.paid_amount, 0)).toBe(o.payable);
      expect(o.refunded_amount).toBe(o.items.reduce((s, it) => s + it.refunded_amount, 0));
    }
  });

  it("가상 표시: 회원·직원 이메일 도메인, 직원은 비활성, 지난 시각 주기 작업 기록은 남기지 않는다", async () => {
    expect(await db.user.count({ where: { email: { endsWith: `@${SYNTH_DOMAIN}` } } })).toBe(1500);
    const staff = await db.staff.findUniqueOrThrow({ where: { email: SYNTH_STAFF_EMAIL } });
    expect(staff.active).toBe(false);
    expect(await db.jobRun.count()).toBe(0);
    const coupons = await db.coupon.findMany({ where: { code: { startsWith: SYNTH_COUPON_PREFIX } } });
    expect(coupons.length).toBeGreaterThan(0);
  });

  it("정답지는 --out에만 쓰고 저장소에는 없다", () => {
    expect(path.relative(REPO_ROOT, out).startsWith("..")).toBe(true);
    const key = JSON.parse(readFileSync(path.join(out, FILES.answerKey), "utf-8"));
    expect(key.start_effect.name).toBe("시작 구간 효과");
    expect(key.meta.marker.email_domain).toBe(`@${SYNTH_DOMAIN}`);
    expect(key.purchases.inserted).toBeGreaterThan(0);
    expect(existsSync(path.join(out, FILES.personas))).toBe(true);
    expect(existsSync(path.join(out, FILES.traffic))).toBe(true);
    for (const f of Object.values(FILES)) expect(existsSync(path.join(REPO_ROOT, f))).toBe(false);
  });

  it("매일 모드 두 차례: 같은 계획을 두 번 넣지 않는다", async () => {
    const before = await db.order.count({ where: synthUser });
    await runDaily({ out, intervalMin: 10, once: true, maxLateH: 6, log: quiet });
    const mid = await db.order.count({ where: synthUser });
    await runDaily({ out, intervalMin: 10, once: true, maxLateH: 6, log: quiet });
    const after = await db.order.count({ where: synthUser });
    expect(mid).toBeGreaterThanOrEqual(before);
    expect(after).toBeGreaterThanOrEqual(mid);
    expect(after - before).toBeLessThan(20); // 몇 분 사이의 몫만
    const state = JSON.parse(readFileSync(path.join(out, FILES.state), "utf-8")) as DailyState;
    const day = state.days[kstDate(new Date())];
    expect(day.next).toBeLessThanOrEqual(day.total);
    expect(state.inflight).toBeNull();
    expect(existsSync(path.join(out, FILES.lock))).toBe(false);
    // 같은 회원이 같은 순간에 주문 두 개를 만든 일은 없다
    const rows = await db.order.findMany({ where: synthUser, select: { user_id: true, created_at: true } });
    expect(new Set(rows.map((r) => `${r.user_id}|${r.created_at.toISOString()}`)).size).toBe(rows.length);
  }, 300_000);

  it("--replace의 지우기: 가상 데이터만 지우고 실제 주문·일련번호는 그대로", async () => {
    const real = await makeUser();
    const course = await db.course.findFirstOrThrow({ where: { status: "published", sale_price: null }, orderBy: { code: "asc" } });
    await addToCart(real.id, { course_code: course.code });
    const order = await createOrder(real.id, {});
    await mockPay(order.code);
    await deleteSynthetic();
    expect(await countSynthetic()).toEqual({ users: 0, orders: 0, staff: 0 });
    expect(await db.order.count()).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("paid");
    expect(await db.enrollment.count()).toBe(1);
    expect(await db.watchEvent.count()).toBe(0);
    expect(await db.refund.count()).toBe(0);
    expect(await db.inquiry.count()).toBe(0);
    expect(await db.question.count()).toBe(0);
    expect(await db.subscription.count()).toBe(0);
    expect(await db.coupon.count({ where: { code: { startsWith: SYNTH_COUPON_PREFIX } } })).toBe(0);
    expect(await db.payment.count({ where: { NOT: { order_id: order.id } } })).toBe(0);
    // 다음 주문번호가 남은 주문 다음으로 이어진다
    const counter = await db.counter.findUnique({ where: { key: `order:${order.code.slice(2, 8)}` } });
    expect(counter?.last).toBe(Number(order.code.slice(8)));
  }, 600_000);
});
