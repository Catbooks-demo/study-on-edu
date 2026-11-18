import { db } from "@/server/db";

let seq = 0;
const next = () => `${++seq}-${Date.now() % 100000}`;

/** 시험용 수강생. */
export async function makeUser(opts: { email?: string; passwordHash?: string } = {}) {
  const n = next();
  return db.user.create({
    data: {
      email: opts.email ?? `user${n}@studyon.test`,
      password_hash: opts.passwordHash ?? "scrypt$test",
      name: `수강생${n}`,
      phone: "01012345678",
    },
  });
}

/** 시험용 가상 강사. */
export async function makeInstructor(opts: { slug?: string } = {}) {
  const n = next();
  return db.instructor.create({
    data: { slug: opts.slug ?? `test-coder-${n}`, display_name: `시험코더${n}`, bio: "시연용 가상 강사" },
  });
}

/** 시험용 강의 하나 (섹션 1개, 강 n개). */
export async function makeCourse(opts: {
  categoryCode?: string;
  price?: number;
  status?: string;
  lectures?: number[];
  instructorId?: string;
} = {}) {
  const n = next();
  const categoryCode = opts.categoryCode ?? "DEV";
  const category = await db.category.upsert({
    where: { code: categoryCode },
    create: { code: categoryCode, name: categoryCode },
    update: {},
  });
  const instructorId = opts.instructorId ?? (await makeInstructor()).id;
  const course = await db.course.create({
    data: {
      code: `SO-${categoryCode}-T${n}`,
      title: `시험 강의 ${n}`,
      category_id: category.id,
      instructor_id: instructorId,
      level: "beginner",
      price: opts.price ?? 99_000,
      status: opts.status ?? "published",
    },
  });
  const section = await db.section.create({ data: { course_id: course.id, title: "섹션 1", sort: 1 } });
  const lectures = [];
  for (const [i, sec] of (opts.lectures ?? [600, 600]).entries()) {
    lectures.push(
      await db.lecture.create({
        data: { section_id: section.id, course_id: course.id, title: `강 ${i + 1}`, sort: i + 1, duration_sec: sec },
      }),
    );
  }
  return { course, section, lectures };
}

/** 시험용 결제 완료 주문 (강의 하나). */
export async function makePaidOrder(userId: string, courseId: string, paid = 99_000, now = new Date()) {
  const order = await db.order.create({
    data: {
      code: `SOT${next()}`,
      user_id: userId,
      list_total: paid,
      payable: paid,
      status: "paid",
      paid_at: now,
      expires_at: new Date(now.getTime() + 30 * 60_000),
    },
  });
  const item = await db.orderItem.create({
    data: { order_id: order.id, kind: "course", course_id: courseId, list_price: paid, unit_price: paid, paid_amount: paid },
  });
  return { order, item };
}

/** 시험용 월 구독. */
export async function makeSubscription(userId: string, now = new Date()) {
  const plan = await db.plan.upsert({
    where: { code: "monthly" },
    create: { code: "monthly", name: "월 구독", interval: "month", price: 29_000, refund_base_hours: 20 },
    update: {},
  });
  return db.subscription.create({
    data: {
      user_id: userId,
      plan_id: plan.id,
      current_period_start: now,
      current_period_end: new Date(now.getTime() + 30 * 86_400_000),
    },
  });
}
