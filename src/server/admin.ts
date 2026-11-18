import type { Prisma } from "@prisma/client";
import { refundDueAt } from "@/rules/deadlines";
import { courseRefund, courseRefundMethods, subscriptionRefund } from "@/rules/refund";
import { addDays, diffDays, kstDate, kstDateTime } from "@/rules/time";
import { audit } from "./audit";
import { db } from "./db";
import { HttpError } from "./http";
import { subscriptionWatchedSec, usageFor } from "./learning-usage";

/** 직원 화면 서비스. 쓰기는 모두 감사 기록(audit)을 남긴다. */

// ───────────────────────── 대시보드 ─────────────────────────

export type DashboardCounts = {
  today_sales: number;
  today_orders: number;
  refund_requests: number;
  new_subscriptions: number;
  cancellations: number;
  payment_failures: number;
  unanswered_questions: number;
  open_inquiries: number;
  overdue_refunds: number;
};

/** 한국 날짜 하루 [00:00, 다음 날 00:00). */
export function kstDayRange(now: Date): { start: Date; end: Date; date: string } {
  const date = kstDate(now);
  return { start: kstDateTime(date), end: kstDateTime(addDays(date, 1)), date };
}

/**
 * 대시보드 숫자. "오늘"은 KST 날짜다.
 * 오늘 매출 = 오늘 승인된 결제(주문·구독) − 오늘 돌려준 환불 결제. 새 구독 = 첫 청구가 오늘 결제된 구독.
 */
export async function dashboardCounts(now: Date = new Date()): Promise<DashboardCounts> {
  const { start, end } = kstDayRange(now);
  const today = { gte: start, lt: end };
  const [charges, refunds, orders, refundRequests, paidToday, cancellations, failures, questions, inquiries, approved] = await Promise.all([
    db.payment.aggregate({ where: { kind: "charge", status: "approved", approved_at: today }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { kind: "refund", status: "approved", approved_at: today }, _sum: { amount: true } }),
    db.order.count({ where: { paid_at: today, status: { in: ["paid", "partially_refunded", "refunded"] } } }),
    db.refund.count({ where: { status: "requested" } }),
    db.subscriptionInvoice.findMany({ where: { paid_at: today, status: { in: ["paid", "refunded"] } }, select: { subscription_id: true } }),
    db.subscription.count({ where: { status: "cancelled", cancelled_at: today } }),
    db.payment.count({ where: { kind: "charge", status: "failed", created_at: today } }),
    db.question.count({ where: { answered_at: null } }),
    db.inquiry.count({ where: { status: "open" } }),
    db.refund.findMany({ where: { status: "approved" }, select: { approved_at: true } }),
  ]);
  const subIds = [...new Set(paidToday.map((i) => i.subscription_id))];
  const earlier = subIds.length
    ? await db.subscriptionInvoice.findMany({
        where: { subscription_id: { in: subIds }, paid_at: { lt: start }, status: { in: ["paid", "refunded"] } },
        select: { subscription_id: true },
        distinct: ["subscription_id"],
      })
    : [];
  const renewed = new Set(earlier.map((e) => e.subscription_id));
  return {
    today_sales: (charges._sum.amount ?? 0) - (refunds._sum.amount ?? 0),
    today_orders: orders,
    refund_requests: refundRequests,
    new_subscriptions: subIds.filter((id) => !renewed.has(id)).length,
    cancellations,
    payment_failures: failures,
    unanswered_questions: questions,
    open_inquiries: inquiries,
    overdue_refunds: approved.filter((r) => r.approved_at && refundDueAt(r.approved_at) < now).length,
  };
}

/** 최근 n일(KST) 날짜별 매출·주문 수 (대시보드 막대). */
export async function salesByDay(now: Date = new Date(), days = 14): Promise<{ date: string; sales: number; orders: number }[]> {
  const today = kstDate(now);
  const first = addDays(today, -(days - 1));
  const range = { gte: kstDateTime(first), lt: kstDateTime(addDays(today, 1)) };
  const [pays, orders] = await Promise.all([
    db.payment.findMany({ where: { status: "approved", approved_at: range }, select: { kind: true, amount: true, approved_at: true } }),
    db.order.findMany({ where: { paid_at: range }, select: { paid_at: true } }),
  ]);
  const out = Array.from({ length: days }, (_, i) => ({ date: addDays(first, i), sales: 0, orders: 0 }));
  const idx = (d: Date) => diffDays(first, kstDate(d));
  for (const p of pays) {
    const i = idx(p.approved_at!);
    if (out[i]) out[i].sales += p.kind === "refund" ? -p.amount : p.amount;
  }
  for (const o of orders) {
    const i = idx(o.paid_at!);
    if (out[i]) out[i].orders += 1;
  }
  return out;
}

// ───────────────────────── 강의 심사·관리 ─────────────────────────

async function courseByCode(code: string) {
  const c = await db.course.findUnique({ where: { code }, include: { instructor: { include: { users: true } }, _count: { select: { lectures: true } } } });
  if (!c) throw new HttpError(404, "NOT_FOUND", "강의를 찾지 못했어요.");
  return c;
}

/** 강사 계정 메일로 보낸 편지함에 남긴다 (실제로 보내지 않음). */
async function messageInstructor(tx: Prisma.TransactionClient, emails: string[], kind: string, subject: string, body: string) {
  for (const to of emails) {
    await tx.message.create({ data: { user_id: null, channel: "email", to, kind, subject, body: `[스터디온에듀] ${body}` } });
  }
}

/** 심사 승인: in_review → published. 처음 공개면 published_at을 지금으로. */
export async function approveCourse(staffId: string, code: string, now: Date = new Date()) {
  const c = await courseByCode(code);
  if (c.status !== "in_review") throw new HttpError(409, "BAD_STATE", "심사 중인 강의만 승인할 수 있어요.");
  if (!c._count.lectures) throw new HttpError(400, "NO_LECTURES", "강이 하나도 없는 강의는 공개할 수 없어요.");
  return db.$transaction(async (tx) => {
    const changed = await tx.course.updateMany({ where: { id: c.id, status: "in_review" }, data: { status: "published", reject_reason: null, published_at: c.published_at ?? now } });
    if (changed.count !== 1) throw new HttpError(409, "BAD_STATE", "심사 중인 강의만 승인할 수 있어요.");
    await messageInstructor(tx, c.instructor.users.map((u) => u.email), "course_approved", "강의 심사 승인", `「${c.title}」 심사가 끝나 강의가 공개됐어요.`);
    await audit(`staff:${staffId}`, "course.approve", `course:${c.code}`, undefined, tx);
    return tx.course.findUniqueOrThrow({ where: { id: c.id } });
  });
}

/** 심사 반려 (사유 필수): in_review → rejected. 강사에게 사유를 메일로 남긴다. */
export async function rejectCourse(staffId: string, code: string, reason: string) {
  const why = reason.trim();
  if (!why) throw new HttpError(400, "REASON_REQUIRED", "반려 사유를 적어 주세요.");
  const c = await courseByCode(code);
  if (c.status !== "in_review") throw new HttpError(409, "BAD_STATE", "심사 중인 강의만 반려할 수 있어요.");
  return db.$transaction(async (tx) => {
    const changed = await tx.course.updateMany({ where: { id: c.id, status: "in_review" }, data: { status: "rejected", reject_reason: why.slice(0, 1000) } });
    if (changed.count !== 1) throw new HttpError(409, "BAD_STATE", "심사 중인 강의만 반려할 수 있어요.");
    await messageInstructor(
      tx, c.instructor.users.map((u) => u.email), "course_rejected", "강의 심사 반려",
      `「${c.title}」 심사에서 고칠 점이 있어 반려했어요. 사유: ${why} 고친 뒤 다시 심사를 요청해 주세요.`,
    );
    await audit(`staff:${staffId}`, "course.reject", `course:${c.code}`, { reason: why }, tx);
    return tx.course.findUniqueOrThrow({ where: { id: c.id } });
  });
}

/** 공개 강의 숨기기·다시 공개. 산 수강생의 재생은 막지 않는다. */
export async function setCourseHidden(staffId: string, code: string, hidden: boolean) {
  const c = await courseByCode(code);
  const from = hidden ? "published" : "hidden";
  if (c.status !== from) throw new HttpError(409, "BAD_STATE", hidden ? "공개 중인 강의만 숨길 수 있어요." : "숨긴 강의만 다시 공개할 수 있어요.");
  await db.course.update({ where: { id: c.id }, data: { status: hidden ? "hidden" : "published" } });
  await audit(`staff:${staffId}`, hidden ? "course.hide" : "course.show", `course:${c.code}`);
}

export type CourseEdit = { title: string; subtitle: string; price: number; sale_price: number | null; sale_ends_at: Date | null; in_subscription: boolean };

/** 강의 기본 정보 고치기 (제목·가격·할인·구독 대상). */
export async function updateCourse(staffId: string, code: string, input: CourseEdit) {
  const c = await courseByCode(code);
  if (!input.title.trim()) throw new HttpError(400, "BAD_INPUT", "제목을 적어 주세요.");
  if (!Number.isInteger(input.price) || input.price < 0) throw new HttpError(400, "BAD_INPUT", "정가를 확인해 주세요.");
  if (input.sale_price !== null && (input.sale_price < 0 || input.sale_price >= input.price || !input.sale_ends_at)) {
    throw new HttpError(400, "BAD_INPUT", "할인가는 정가보다 낮게, 마감 시각과 함께 넣어 주세요.");
  }
  await db.course.update({
    where: { id: c.id },
    data: {
      title: input.title.trim().slice(0, 200),
      subtitle: input.subtitle.trim().slice(0, 300),
      price: input.price,
      sale_price: input.sale_price,
      sale_ends_at: input.sale_price === null ? null : input.sale_ends_at,
      in_subscription: input.in_subscription,
    },
  });
  await audit(`staff:${staffId}`, "course.edit", `course:${c.code}`, {
    price: input.price, sale_price: input.sale_price, in_subscription: input.in_subscription,
  });
}

// ───────────────────────── 환불 계산기 ─────────────────────────

export type RefundCalc = {
  kind: "course" | "subscription";
  paid: number;
  elapsed_days: number;
  progress_ratio: number;
  period_ratio: number | null;
  /** 진도(시청) 방식 환불액 */
  progress_based: number;
  /** 경과일(기간) 방식 환불액. 평생 강의는 null */
  period_based: number | null;
  /** 실제 적용(규칙대로) */
  applied: number;
  basis_ko: string;
};

/** 직원 환불 계산기: 진도 방식·경과일 방식을 나란히, 실제 적용 값과 근거. 지금 시각으로 다시 계산한다. */
export async function refundCalculator(refundId: string, now: Date = new Date()): Promise<RefundCalc> {
  const r = await db.refund.findUnique({
    where: { id: refundId },
    include: {
      order_item: { include: { order: true, course: true, bundle: { include: { courses: true } } } },
      invoice: { include: { subscription: { include: { plan: true } } } },
    },
  });
  if (!r) throw new HttpError(404, "NOT_FOUND", "환불 요청을 찾지 못했어요.");
  if (r.order_item) {
    const item = r.order_item;
    if (!item.order.paid_at) throw new HttpError(409, "NOT_PAID", "결제되지 않은 주문이에요.");
    const courseIds = item.course_id ? [item.course_id] : (item.bundle?.courses.map((bc) => bc.course_id) ?? []);
    const input = {
      paid: item.paid_amount,
      paid_at: item.order.paid_at,
      now,
      access_days: item.course ? item.course.access_days : (item.bundle?.access_days ?? null),
      lectures: await usageFor(r.user_id, courseIds),
    };
    const m = courseRefundMethods(input);
    const q = courseRefund(input);
    return {
      kind: "course",
      paid: item.paid_amount,
      elapsed_days: q.elapsed_days,
      progress_ratio: q.progress_ratio,
      period_ratio: q.period_ratio,
      progress_based: m.progress_based,
      period_based: m.period_based,
      applied: m.applied,
      basis_ko: q.basis_ko,
    };
  }
  const inv = r.invoice;
  if (!inv || !inv.paid_at) throw new HttpError(409, "NOT_PAID", "결제된 구독 청구가 아니에요.");
  const watched = await subscriptionWatchedSec(inv.subscription_id, inv.period_start, inv.period_end);
  const q = subscriptionRefund({
    paid: inv.amount,
    paid_at: inv.paid_at,
    period_start: inv.period_start,
    period_end: inv.period_end,
    now,
    watched_sec: watched,
    base_hours: inv.subscription.plan.refund_base_hours,
  });
  // 구독: 시청 방식 = 결제액 − 결제액 × 시청 ÷ 기준 시간, 경과일 방식 = 결제액 − 결제액 × 경과일 ÷ 기간 일수
  const baseSec = Math.max(1, inv.subscription.plan.refund_base_hours * 3600);
  const watchUsed = Math.floor((inv.amount * Math.min(watched, baseSec)) / baseSec);
  const periodDays = Math.max(1, diffDays(kstDate(inv.period_start), kstDate(inv.period_end)));
  const elapsed = Math.min(periodDays, Math.max(0, diffDays(kstDate(inv.period_start), kstDate(now))));
  const periodUsed = Math.floor((inv.amount * elapsed) / periodDays);
  return {
    kind: "subscription",
    paid: inv.amount,
    elapsed_days: q.elapsed_days,
    progress_ratio: q.progress_ratio,
    period_ratio: q.period_ratio,
    progress_based: q.kind === "full" ? inv.amount : Math.max(0, inv.amount - watchUsed),
    period_based: q.kind === "full" ? inv.amount : Math.max(0, inv.amount - periodUsed),
    applied: q.refund,
    basis_ko: q.basis_ko,
  };
}

// ───────────────────────── 구독 목록 ─────────────────────────

const PAID_ONCE = { some: { status: { in: ["paid", "refunded"] } } };

/**
 * 직원 구독 목록. 결제 한 번 없이 끝난 가입(첫 청구 미결제 → expired로 저장)은 기본으로 뺀다.
 * includeUnpaid면 함께 보여 주고 화면에서 "결제 전 가입"으로 표시한다.
 */
export async function adminSubscriptions(f: { status?: string; q?: string; includeUnpaid?: boolean; page?: number; take?: number }) {
  const take = f.take ?? 50;
  const page = Math.max(1, f.page ?? 1);
  const where: Prisma.SubscriptionWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.includeUnpaid ? {} : { invoices: PAID_ONCE }),
    ...(f.q ? { user: { OR: [{ email: { contains: f.q, mode: "insensitive" } }, { name: { contains: f.q } }] } } : {}),
  };
  const [items, total] = await Promise.all([
    db.subscription.findMany({
      where,
      include: { plan: true, user: { select: { id: true, name: true, email: true } }, invoices: { orderBy: { period_start: "desc" }, take: 3 } },
      orderBy: { created_at: "desc" },
      skip: (page - 1) * take,
      take,
    }),
    db.subscription.count({ where }),
  ]);
  return {
    items: items.map((s) => ({ ...s, never_paid: !s.invoices.some((i) => i.status === "paid" || i.status === "refunded") })),
    total,
    pages: Math.max(1, Math.ceil(total / take)),
  };
}

// ───────────────────────── 강사 ─────────────────────────

/** 강사 활동 멈춤·다시 켜기. 멈추면 강사 세션을 끊는다(공개 강사 페이지도 안 보인다). */
export async function setInstructorStatus(staffId: string, id: string, status: "active" | "suspended") {
  const ins = await db.instructor.findUnique({ where: { id } });
  if (!ins) throw new HttpError(404, "NOT_FOUND", "강사를 찾지 못했어요.");
  if (ins.status === status) return ins;
  const out = await db.$transaction(async (tx) => {
    const row = await tx.instructor.update({ where: { id }, data: { status } });
    if (status === "suspended") await tx.instructorSession.deleteMany({ where: { instructor_user: { instructor_id: id } } });
    await audit(`staff:${staffId}`, status === "suspended" ? "instructor.suspend" : "instructor.activate", `instructor:${id}`, undefined, tx);
    return row;
  });
  return out;
}
