import type { Prisma, Settlement } from "@prisma/client";
import { allocate } from "@/rules/pricing";
import { REFERRAL_RATE, SALE_RATE, payDate, refundShare, saleShare, settle, subscriptionShare } from "@/rules/settlement";
import { kstMonth, kstMonthRange, prevMonth } from "@/rules/time";
import { audit } from "./audit";
import { db } from "./db";
import { HttpError } from "./http";
import { can } from "./roles";

/**
 * 강사 월 정산. 판매는 결제가 승인된 달, 환불은 환불이 끝난 달에 잡는다(모두 KST 달).
 * 패키지는 묶음 강의 정가 비율로 나누고, 추천 코드는 그 강사 본인 강의일 때만 90%다.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const itemInclude = {
  order: { select: { code: true, coupon: { select: { referral: true, instructor_id: true } } } },
  course: { select: { id: true, instructor_id: true } },
  bundle: {
    select: { code: true, courses: { orderBy: { sort: "asc" as const }, select: { course: { select: { id: true, instructor_id: true, price: true } } } } },
  },
} as const;
type ItemRow = Prisma.OrderItemGetPayload<{ include: typeof itemInclude }>;

/** 항목 금액을 강사별로 나눈다: 단건은 그 강사, 패키지는 묶음 강의 정가 비율(allocate). */
function splitItem(item: ItemRow, amount: number): { instructor_id: string; amount: number; referral: boolean }[] {
  const coupon = item.order.coupon;
  if (item.course) {
    const referral = !!coupon?.referral && coupon.instructor_id === item.course.instructor_id;
    return [{ instructor_id: item.course.instructor_id, amount, referral }];
  }
  const courses = item.bundle?.courses.map((bc) => bc.course) ?? [];
  if (!courses.length) return [];
  const parts = allocate(amount, courses.map((c) => c.price));
  // 추천 코드는 패키지 줄에 쓰이지 않는다(쿠폰 대상이 강사이면 패키지 줄에 적용되지 않음) → 70%
  return courses.map((c, i) => ({ instructor_id: c.instructor_id, amount: parts[i], referral: false }));
}

const refOf = (item: ItemRow) => (item.bundle ? `order:${item.order.code}/${item.bundle.code}` : `order:${item.order.code}`);

type LineIn = { kind: string; ref: string; base_amount: number; rate: number; amount: number };
type Acc = {
  sales: { amount: number; referral: boolean }[];
  refunds: { amount: number; rate: number }[];
  sec: number;
  lines: LineIn[];
};

const newAcc = (): Acc => ({ sales: [], refunds: [], sec: 0, lines: [] });

/** 그달 숫자를 모은다 (저장하지 않음). */
async function gather(month: string) {
  const { start, end } = kstMonthRange(month);
  const inMonth = { gte: start, lt: end };
  const by = new Map<string, Acc>();
  const acc = (id: string) => {
    let a = by.get(id);
    if (!a) by.set(id, (a = newAcc()));
    return a;
  };

  // 판매: 그달에 승인된 주문 결제 (주문마다 한 번)
  const charges = await db.payment.findMany({
    where: { kind: "charge", status: "approved", order_id: { not: null }, approved_at: inMonth },
    select: { order_id: true },
  });
  const orderIds = [...new Set(charges.map((c) => c.order_id!))];
  const items = orderIds.length
    ? await db.orderItem.findMany({ where: { order_id: { in: orderIds } }, include: itemInclude, orderBy: { created_at: "asc" } })
    : [];
  for (const item of items) {
    for (const part of splitItem(item, item.paid_amount)) {
      if (part.amount <= 0) continue;
      const a = acc(part.instructor_id);
      a.sales.push({ amount: part.amount, referral: part.referral });
      a.lines.push({
        kind: part.referral ? "referral" : "sale",
        ref: refOf(item),
        base_amount: part.amount,
        rate: part.referral ? REFERRAL_RATE : SALE_RATE,
        amount: saleShare(part.amount, part.referral),
      });
    }
  }

  // 환불: 그달에 끝난 환불을 원래 비율로 차감
  const refunds = await db.refund.findMany({
    where: { status: "done", done_at: inMonth, order_item_id: { not: null } },
    include: { order_item: { include: itemInclude } },
    orderBy: { done_at: "asc" },
  });
  for (const r of refunds) {
    if (!r.order_item) continue;
    for (const part of splitItem(r.order_item, r.amount)) {
      if (part.amount <= 0) continue;
      const rate = part.referral ? REFERRAL_RATE : SALE_RATE;
      const a = acc(part.instructor_id);
      a.refunds.push({ amount: part.amount, rate });
      a.lines.push({ kind: "refund", ref: `refund:${r.id}`, base_amount: part.amount, rate, amount: -refundShare(part.amount, rate) });
    }
  }

  // 구독 풀 = 그달 승인된 구독 결제 − 그달 끝난 구독 환불 (0 아래로는 내려가지 않는다)
  const [subPaid, subRefunded] = await Promise.all([
    db.payment.aggregate({ where: { kind: "charge", status: "approved", invoice_id: { not: null }, approved_at: inMonth }, _sum: { amount: true } }),
    db.refund.aggregate({ where: { status: "done", invoice_id: { not: null }, done_at: inMonth }, _sum: { amount: true } }),
  ]);
  const pool = Math.max(0, (subPaid._sum.amount ?? 0) - (subRefunded._sum.amount ?? 0));

  // 시청 비중: 그달 구독 수강권으로 새로 본 초
  const watch = await db.watchEvent.groupBy({
    by: ["course_id"],
    where: { source: "subscription", created_at: inMonth },
    _sum: { added_sec: true },
  });
  const courseIds = watch.map((w) => w.course_id);
  const owners = courseIds.length
    ? await db.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, instructor_id: true } })
    : [];
  const ownerOf = new Map(owners.map((c) => [c.id, c.instructor_id]));
  let totalSec = 0;
  for (const w of watch) {
    const sec = w._sum.added_sec ?? 0;
    const owner = ownerOf.get(w.course_id);
    if (!owner || sec <= 0) continue;
    totalSec += sec;
    acc(owner).sec += sec;
  }

  // 앞달 음수 이월
  const prev = prevMonth(month);
  const negatives = await db.settlement.findMany({ where: { month: prev, total: { lt: 0 } }, select: { instructor_id: true, total: true } });
  const carry = new Map(negatives.map((s) => [s.instructor_id, s.total]));
  for (const id of carry.keys()) acc(id);

  return { by, pool, totalSec, carry, prev };
}

/** 한 강사의 계산 결과와 줄. */
function settleOne(month: string, a: Acc, pool: number, totalSec: number, carriedIn: number, prev: string) {
  const r = settle({ sales: a.sales, refunds: a.refunds, pool, instructor_sec: a.sec, total_sec: totalSec, carried_in: carriedIn });
  const lines = [...a.lines];
  if (r.subscription_share > 0 || a.sec > 0) {
    lines.push({
      kind: "subscription",
      ref: `pool:${month}:${a.sec}/${totalSec}`,
      base_amount: pool,
      rate: totalSec ? (0.5 * a.sec) / totalSec : 0,
      amount: subscriptionShare(pool, a.sec, totalSec),
    });
  }
  if (r.carried_in) lines.push({ kind: "carry", ref: `settlement:${prev}`, base_amount: r.carried_in, rate: 1, amount: r.carried_in });
  return { r, lines };
}

export type MonthPreview = { instructor_id: string; total: number; payout: number; carry_out: number } & ReturnType<typeof settle>;

/** 그달 정산을 저장하지 않고 미리 계산 (대시보드 예상 정산용). */
export async function previewMonth(month: string): Promise<MonthPreview[]> {
  const { by, pool, totalSec, carry, prev } = await gather(month);
  return [...by.entries()].map(([id, a]) => ({ instructor_id: id, ...settleOne(month, a, pool, totalSec, carry.get(id) ?? 0, prev).r }));
}

/**
 * 그달(KST YYYY-MM) 정산을 계산해 settlements·settlement_lines에 저장한다.
 * draft는 다시 계산하고(줄을 갈아 끼움), confirmed는 건드리지 않는다. 저장한 강사 수를 돌려준다.
 */
export async function computeMonth(month: string, now: Date = new Date()): Promise<number> {
  if (!MONTH_RE.test(month)) throw new HttpError(400, "BAD_MONTH", "정산 달을 YYYY-MM 형식으로 골라 주세요.");
  if (month > kstMonth(now)) throw new HttpError(400, "FUTURE_MONTH", "아직 오지 않은 달은 계산할 수 없어요.");
  const { by, pool, totalSec, carry, prev } = await gather(month);
  const pay_date = payDate(month);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settle:${month}`}))`;
      let n = 0;
      for (const [instructorId, a] of by) {
        const existing = await tx.settlement.findUnique({ where: { instructor_id_month: { instructor_id: instructorId, month } } });
        if (existing?.status === "confirmed") continue;
        const { r, lines } = settleOne(month, a, pool, totalSec, carry.get(instructorId) ?? 0, prev);
        const data = {
          sales_amount: r.sales_amount,
          sales_share: r.sales_share,
          referral_amount: r.referral_amount,
          referral_share: r.referral_share,
          subscription_share: r.subscription_share,
          refund_deduction: r.refund_deduction,
          carried_in: r.carried_in,
          total: r.total,
          payout: r.payout,
          pay_date,
        };
        const s = await tx.settlement.upsert({
          where: { instructor_id_month: { instructor_id: instructorId, month } },
          create: { instructor_id: instructorId, month, ...data },
          update: data,
        });
        await tx.settlementLine.deleteMany({ where: { settlement_id: s.id } });
        if (lines.length) await tx.settlementLine.createMany({ data: lines.map((l) => ({ settlement_id: s.id, ...l })) });
        n++;
      }
      // 이번에 숫자가 없어진 draft(예: 판매가 다른 달로 옮겨 감)는 지운다
      await tx.settlement.deleteMany({ where: { month, status: "draft", instructor_id: { notIn: [...by.keys()] } } });
      return n;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

/** 정산 확정 (관리자만). 확정 뒤에는 다시 계산해도 바뀌지 않는다. */
export async function confirmSettlement(staffId: string, id: string, now: Date = new Date()): Promise<Settlement> {
  const staff = await db.staff.findUnique({ where: { id: staffId } });
  if (!staff || !staff.active || !can(staff.role, "settlements")) throw new HttpError(403, "FORBIDDEN", "정산 확정은 관리자만 할 수 있어요.");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM settlements WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw new HttpError(404, "NOT_FOUND", "정산을 찾지 못했어요.");
    const s = await tx.settlement.findUniqueOrThrow({ where: { id } });
    if (s.status !== "draft") throw new HttpError(409, "BAD_STATE", "이미 확정한 정산이에요.");
    const out = await tx.settlement.update({ where: { id }, data: { status: "confirmed", confirmed_by: staffId, confirmed_at: now } });
    await audit(`staff:${staffId}`, "settlement.confirm", `settlement:${id}`, { month: s.month, instructor_id: s.instructor_id, payout: s.payout }, tx);
    return out;
  });
}

/** 강사 한 명의 정산 내역 (최근 달 먼저, 줄 포함). */
export async function instructorSettlements(instructorId: string) {
  return db.settlement.findMany({
    where: { instructor_id: instructorId },
    include: { lines: { orderBy: [{ kind: "asc" }, { created_at: "asc" }] } },
    orderBy: { month: "desc" },
    take: 36,
  });
}

/** 화면·API용 정산 모양. */
export function settlementView(s: Settlement) {
  return {
    id: s.id,
    instructor_id: s.instructor_id,
    month: s.month,
    sales_amount: s.sales_amount,
    sales_share: s.sales_share,
    referral_amount: s.referral_amount,
    referral_share: s.referral_share,
    subscription_share: s.subscription_share,
    refund_deduction: s.refund_deduction,
    carried_in: s.carried_in,
    total: s.total,
    payout: s.payout,
    carry_out: Math.min(0, s.total),
    status: s.status,
    pay_date: s.pay_date,
    confirmed_at: s.confirmed_at?.toISOString() ?? null,
  };
}

/** 주기 작업: 달이 바뀌면(KST 1일 첫 작업) 전월분을 한 번 계산한다. 서버가 1일에 꺼져 있었으면 다음에 켜질 때 계산한다. */
export async function monthlySettlement(now: Date): Promise<number> {
  const month = prevMonth(kstMonth(now));
  const key = `settlement-job:${month}`;
  if (await db.counter.findUnique({ where: { key } })) return 0;
  const n = await computeMonth(month, now);
  await db.counter.upsert({ where: { key }, create: { key, last: 1 }, update: {} });
  return n;
}
