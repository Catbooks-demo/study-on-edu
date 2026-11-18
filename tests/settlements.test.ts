import { beforeEach, describe, expect, it } from "vitest";
import { POST as confirmRoute } from "@/app/api/admin/settlements/[id]/confirm/route";
import { STAFF_COOKIE, issueStaffSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { runJobsOnce } from "@/server/jobs";
import { computeMonth, confirmSettlement, instructorSettlements } from "@/server/settlements";
import { resetDb } from "./helpers/db";
import { call } from "./helpers/http";
import { makeBundle, makeCoupon, makeCourse, makeInstructor, makeStaff, makeSubscription, makeUser } from "./helpers/fixtures";

let seq = 0;

beforeEach(async () => {
  await resetDb();
});

type Line = { courseId?: string; bundleId?: string; list: number; paid: number };

/** approvedAt에 승인된 결제가 있는 주문. */
async function sale(lines: Line[], approvedAt: Date, couponId: string | null = null) {
  const user = await makeUser();
  const total = lines.reduce((a, l) => a + l.paid, 0);
  const order = await db.order.create({
    data: {
      code: `SOS${++seq}`,
      user_id: user.id,
      list_total: lines.reduce((a, l) => a + l.list, 0),
      payable: total,
      coupon_id: couponId,
      status: "paid",
      paid_at: approvedAt,
      expires_at: new Date(approvedAt.getTime() + 30 * 60_000),
    },
  });
  const items = [];
  for (const l of lines) {
    items.push(
      await db.orderItem.create({
        data: {
          order_id: order.id,
          kind: l.bundleId ? "bundle" : "course",
          course_id: l.courseId ?? null,
          bundle_id: l.bundleId ?? null,
          list_price: l.list,
          unit_price: l.list,
          coupon_share: l.list - l.paid,
          paid_amount: l.paid,
        },
      }),
    );
  }
  await db.payment.create({ data: { order_id: order.id, kind: "charge", method: "mock", amount: total, status: "approved", approved_at: approvedAt } });
  return { user, order, items };
}

async function refundDone(userId: string, orderItemId: string, amount: number, doneAt: Date) {
  return db.refund.create({
    data: { user_id: userId, order_item_id: orderItemId, reason: "시험", basis: {}, calc_amount: amount, amount, status: "done", approved_at: doneAt, done_at: doneAt },
  });
}

const settlementOf = (instructorId: string, month: string) =>
  db.settlement.findUnique({ where: { instructor_id_month: { instructor_id: instructorId, month } }, include: { lines: true } });

describe("정산 월 계산", () => {
  it("month boundary is KST", async () => {
    const { course } = await makeCourse({ price: 99_000 });
    await sale([{ courseId: course.id, list: 99_000, paid: 99_000 }], new Date("2026-11-30T15:30:00Z")); // KST 12월 1일 00:30
    const now = new Date("2026-12-02T00:00:00Z");
    expect(await computeMonth("2026-11", now)).toBe(0);
    expect(await settlementOf(course.instructor_id, "2026-11")).toBeNull();
    expect(await computeMonth("2026-12", now)).toBe(1);
    const dec = await settlementOf(course.instructor_id, "2026-12");
    expect(dec?.sales_amount).toBe(99_000);
    expect(dec?.sales_share).toBe(69_300);
    expect(dec?.pay_date).toBe("2027-01-10");
    expect(dec?.status).toBe("draft");
  });

  it("bundle split by list price", async () => {
    const a = await makeCourse({ price: 60_000 });
    const b = await makeCourse({ price: 40_000 });
    const bundle = await makeBundle([a.course.id, b.course.id], { price: 80_000 });
    await sale([{ bundleId: bundle.id, list: 80_000, paid: 80_000 }], new Date("2026-11-10T03:00:00Z"));
    expect(await computeMonth("2026-11", new Date("2026-12-01T00:00:00Z"))).toBe(2);
    const sa = await settlementOf(a.course.instructor_id, "2026-11");
    const sb = await settlementOf(b.course.instructor_id, "2026-11");
    expect(sa?.sales_amount).toBe(48_000);
    expect(sb?.sales_amount).toBe(32_000);
    expect(sa?.sales_share).toBe(33_600);
    expect(sb?.sales_share).toBe(22_400);
  });

  it("referral only own course", async () => {
    const ia = await makeInstructor({ slug: "ref-a" });
    const ib = await makeInstructor({ slug: "ref-b" });
    const a = await makeCourse({ price: 50_000, instructorId: ia.id });
    const b = await makeCourse({ price: 40_000, instructorId: ib.id });
    const coupon = await makeCoupon({ code: "REF-ref-a", target: "instructor", targetRef: ia.slug, referral: true, instructorId: ia.id });
    await sale(
      [
        { courseId: a.course.id, list: 50_000, paid: 45_000 },
        { courseId: b.course.id, list: 40_000, paid: 40_000 },
      ],
      new Date("2026-11-10T03:00:00Z"),
      coupon.id,
    );
    await computeMonth("2026-11", new Date("2026-12-01T00:00:00Z"));
    const sa = await settlementOf(ia.id, "2026-11");
    const sb = await settlementOf(ib.id, "2026-11");
    expect(sa?.referral_amount).toBe(45_000);
    expect(sa?.referral_share).toBe(40_500);
    expect(sa?.sales_amount).toBe(0);
    expect(sb?.referral_amount).toBe(0);
    expect(sb?.sales_amount).toBe(40_000);
    expect(sb?.sales_share).toBe(28_000);
  });

  it("refund in refund month", async () => {
    const { course } = await makeCourse({ price: 99_000 });
    const { user, items } = await sale([{ courseId: course.id, list: 99_000, paid: 99_000 }], new Date("2026-11-10T03:00:00Z"));
    await refundDone(user.id, items[0].id, 99_000, new Date("2026-12-05T03:00:00Z"));
    const now = new Date("2027-01-02T00:00:00Z");
    await computeMonth("2026-11", now);
    await computeMonth("2026-12", now);
    const nov = await settlementOf(course.instructor_id, "2026-11");
    const dec = await settlementOf(course.instructor_id, "2026-12");
    expect(nov?.sales_share).toBe(69_300);
    expect(nov?.refund_deduction).toBe(0);
    expect(nov?.payout).toBe(69_300);
    expect(dec?.refund_deduction).toBe(69_300);
    expect(dec?.total).toBe(-69_300);
    expect(dec?.payout).toBe(0);

    // 음수는 다음 달 carried_in으로
    await sale([{ courseId: course.id, list: 99_000, paid: 99_000 }], new Date("2027-01-05T03:00:00Z"));
    await computeMonth("2027-01", new Date("2027-02-01T00:00:00Z"));
    const jan = await settlementOf(course.instructor_id, "2027-01");
    expect(jan?.carried_in).toBe(-69_300);
    expect(jan?.total).toBe(0);
    expect(jan?.payout).toBe(0);
    expect(jan?.lines.some((l) => l.kind === "carry" && l.amount === -69_300)).toBe(true);
  });

  it("refund at referral rate", async () => {
    const ia = await makeInstructor({ slug: "ref-c" });
    const a = await makeCourse({ price: 50_000, instructorId: ia.id });
    const coupon = await makeCoupon({ code: "REF-ref-c", target: "instructor", targetRef: ia.slug, referral: true, instructorId: ia.id });
    const { user, items } = await sale([{ courseId: a.course.id, list: 50_000, paid: 45_000 }], new Date("2026-11-10T03:00:00Z"), coupon.id);
    await refundDone(user.id, items[0].id, 45_000, new Date("2026-11-12T03:00:00Z"));
    await computeMonth("2026-11", new Date("2026-12-01T00:00:00Z"));
    const s = await settlementOf(ia.id, "2026-11");
    expect(s?.referral_share).toBe(40_500);
    expect(s?.refund_deduction).toBe(40_500);
    expect(s?.total).toBe(0);
  });

  it("subscription pool and watch share", async () => {
    const a = await makeCourse({ inSubscription: true, lectures: [3600] });
    const b = await makeCourse({ inSubscription: true, lectures: [3600] });
    const at = new Date("2026-11-10T03:00:00Z");
    const u1 = await makeUser();
    const u2 = await makeUser();
    for (const u of [u1, u2]) {
      const sub = await makeSubscription(u.id, at);
      const inv = await db.subscriptionInvoice.create({
        data: { subscription_id: sub.id, period_start: at, period_end: new Date(at.getTime() + 30 * 86_400_000), amount: 29_000, status: "paid", paid_at: at },
      });
      await db.payment.create({ data: { invoice_id: inv.id, kind: "charge", method: "mock", amount: 29_000, status: "approved", approved_at: at } });
      if (u === u2) {
        await db.refund.create({
          data: { user_id: u.id, invoice_id: inv.id, reason: "시험", basis: {}, calc_amount: 29_000, amount: 29_000, status: "done", approved_at: at, done_at: at },
        });
      }
    }
    const device = await db.device.create({ data: { user_id: u1.id, device_key: "dev-key-0001", name: "시험 기기" } });
    const watch = (lectureId: string, courseId: string, sec: number, source = "subscription") =>
      db.watchEvent.create({ data: { user_id: u1.id, lecture_id: lectureId, course_id: courseId, device_id: device.id, from_sec: 0, to_sec: sec, rate: 1, added_sec: sec, source, created_at: at } });
    await watch(a.lectures[0].id, a.course.id, 3_600);
    await watch(b.lectures[0].id, b.course.id, 1_200);
    await watch(b.lectures[0].id, b.course.id, 9_999, "order"); // 구독 수강권이 아닌 시청은 세지 않는다
    // 다음 달 시청은 이번 달 몫에 들어가지 않는다
    await db.watchEvent.create({
      data: { user_id: u1.id, lecture_id: b.lectures[0].id, course_id: b.course.id, device_id: device.id, from_sec: 0, to_sec: 10, rate: 1, added_sec: 50_000, source: "subscription", created_at: new Date("2026-11-30T15:00:00Z") },
    });

    await computeMonth("2026-11", new Date("2026-12-01T00:00:00Z"));
    // 풀 = 58,000 − 29,000 = 29,000. A 3600/4800, B 1200/4800
    const sa = await settlementOf(a.course.instructor_id, "2026-11");
    const sb = await settlementOf(b.course.instructor_id, "2026-11");
    expect(sa?.subscription_share).toBe(10_875);
    expect(sb?.subscription_share).toBe(3_625);
  });

  it("recompute draft idempotent", async () => {
    const { course } = await makeCourse({ price: 99_000 });
    await sale([{ courseId: course.id, list: 99_000, paid: 99_000 }], new Date("2026-11-10T03:00:00Z"));
    await sale([{ courseId: course.id, list: 99_000, paid: 99_000 }], new Date("2026-11-11T03:00:00Z"));
    const now = new Date("2026-12-01T00:00:00Z");
    await computeMonth("2026-11", now);
    const lines1 = await db.settlementLine.count();
    await computeMonth("2026-11", now);
    expect(await db.settlementLine.count()).toBe(lines1);
    expect(await db.settlement.count()).toBe(1);
    expect((await settlementOf(course.instructor_id, "2026-11"))?.sales_amount).toBe(198_000);
  });

  it("confirmed untouched", async () => {
    const admin = await makeStaff("admin");
    const { course } = await makeCourse({ price: 99_000 });
    await sale([{ courseId: course.id, list: 99_000, paid: 99_000 }], new Date("2026-11-10T03:00:00Z"));
    const now = new Date("2026-12-01T00:00:00Z");
    await computeMonth("2026-11", now);
    const s = (await settlementOf(course.instructor_id, "2026-11"))!;
    const confirmed = await confirmSettlement(admin.id, s.id);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmed_by).toBe(admin.id);
    expect(await db.auditLog.count({ where: { action: "settlement.confirm", target: `settlement:${s.id}` } })).toBe(1);

    await sale([{ courseId: course.id, list: 99_000, paid: 99_000 }], new Date("2026-11-20T03:00:00Z"));
    expect(await computeMonth("2026-11", now)).toBe(0);
    const after = (await settlementOf(course.instructor_id, "2026-11"))!;
    expect(after.sales_amount).toBe(99_000);
    expect(after.status).toBe("confirmed");
    await expect(confirmSettlement(admin.id, s.id)).rejects.toMatchObject({ status: 409 });

    const mine = await instructorSettlements(course.instructor_id);
    expect(mine.map((x) => x.month)).toEqual(["2026-11"]);
  });

  it("cs cannot confirm 403", async () => {
    const cs = await makeStaff("cs");
    const { course } = await makeCourse({ price: 99_000 });
    await sale([{ courseId: course.id, list: 99_000, paid: 99_000 }], new Date("2026-11-10T03:00:00Z"));
    await computeMonth("2026-11", new Date("2026-12-01T00:00:00Z"));
    const s = (await settlementOf(course.instructor_id, "2026-11"))!;
    const res = await call(confirmRoute, { method: "POST", cookies: { [STAFF_COOKIE]: await issueStaffSession(cs.id) }, params: { id: s.id } });
    expect(res.status).toBe(403);
    await expect(confirmSettlement(cs.id, s.id)).rejects.toMatchObject({ status: 403 });
    expect((await db.settlement.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("draft");

    const admin = await makeStaff("admin");
    const ok = await call(confirmRoute, { method: "POST", cookies: { [STAFF_COOKIE]: await issueStaffSession(admin.id) }, params: { id: s.id } });
    expect(ok.status).toBe(200);
    expect(ok.body.settlement.status).toBe("confirmed");
  });

  it("monthly job runs once on KST 1st for previous month", async () => {
    const { course } = await makeCourse({ price: 99_000 });
    await sale([{ courseId: course.id, list: 99_000, paid: 99_000 }], new Date("2026-11-10T03:00:00Z"));
    // KST 11월 30일 23:59 → 아직 아니다
    const before = await runJobsOnce(new Date("2026-11-30T14:59:00Z"));
    expect(before.monthlySettlement).toBe(0);
    expect(await db.settlement.count()).toBe(0);
    // KST 12월 1일 00:01 → 11월분
    const first = await runJobsOnce(new Date("2026-11-30T15:01:00Z"));
    expect(first.monthlySettlement).toBe(1);
    expect((await settlementOf(course.instructor_id, "2026-11"))?.sales_amount).toBe(99_000);
    // 같은 날 다시 돌면 건너뛴다
    const again = await runJobsOnce(new Date("2026-11-30T15:02:00Z"));
    expect(again.monthlySettlement).toBe(0);
  });
});
