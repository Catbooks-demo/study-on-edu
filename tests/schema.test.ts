import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetDb } from "./helpers/db";
import { makeCourse, makePaidOrder, makeSubscription, makeUser } from "./helpers/fixtures";

beforeEach(resetDb);

/** DB unique 위반 (Prisma P2002 또는 raw 쿼리의 23505). */
async function expectUniqueViolation(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).not.toBeNull();
  const known = err instanceof Prisma.PrismaClientKnownRequestError ? err.code : "";
  const text = String((err as Error)?.message ?? err);
  expect(known === "P2002" || /23505|unique/i.test(text)).toBe(true);
}

describe("DB 제약", () => {
  it("one open refund per item", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    const { item } = await makePaidOrder(user.id, course.id);
    const base = { user_id: user.id, order_item_id: item.id, reason: "단순 변심", basis: {}, calc_amount: 1000, amount: 1000 };
    await db.refund.create({ data: { ...base, status: "requested" } });
    await expectUniqueViolation(db.refund.create({ data: { ...base, status: "requested" } }));
    await expectUniqueViolation(db.refund.create({ data: { ...base, status: "approved" } }));
    // 끝난(거절·완료) 요청은 여러 개여도 된다
    await db.refund.create({ data: { ...base, status: "rejected" } });
    await db.refund.create({ data: { ...base, status: "rejected" } });
    expect(await db.refund.count({ where: { order_item_id: item.id } })).toBe(3);
  });

  it("one open refund per invoice", async () => {
    const user = await makeUser();
    const sub = await makeSubscription(user.id);
    const inv = await db.subscriptionInvoice.create({
      data: { subscription_id: sub.id, period_start: sub.current_period_start, period_end: sub.current_period_end, amount: 29_000 },
    });
    const base = { user_id: user.id, invoice_id: inv.id, reason: "해지", basis: {}, calc_amount: 0, amount: 0 };
    await db.refund.create({ data: { ...base, status: "requested" } });
    await expectUniqueViolation(db.refund.create({ data: { ...base, status: "approved" } }));
  });

  it("one invoice per period", async () => {
    const user = await makeUser();
    const sub = await makeSubscription(user.id);
    const data = { subscription_id: sub.id, period_start: sub.current_period_start, period_end: sub.current_period_end, amount: 29_000 };
    await db.subscriptionInvoice.create({ data });
    await expectUniqueViolation(db.subscriptionInvoice.create({ data }));
  });

  it("one active device key", async () => {
    const user = await makeUser();
    const data = { user_id: user.id, device_key: "dev-abc", name: "크롬 · Windows" };
    const first = await db.device.create({ data });
    await expectUniqueViolation(db.device.create({ data }));
    await db.device.update({ where: { id: first.id }, data: { revoked_at: new Date() } });
    await expect(db.device.create({ data })).resolves.toMatchObject({ device_key: "dev-abc" });
  });

  it("one enrollment per user and course", async () => {
    const user = await makeUser();
    const { course } = await makeCourse();
    const data = { user_id: user.id, course_id: course.id, source: "free", starts_at: new Date() };
    await db.enrollment.create({ data });
    await expectUniqueViolation(db.enrollment.create({ data }));
  });

  it("table names are snake_case", async () => {
    const rows = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    const names = rows.map((r) => r.tablename);
    expect(names).toEqual(expect.arrayContaining(["courses", "lecture_progress", "subscription_invoices", "counters", "playback_leases"]));
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
