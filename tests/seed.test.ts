import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../prisma/seed-lib";
import { db } from "@/server/db";
import { resetDb } from "./helpers/db";

const now = new Date("2026-11-18T03:00:00Z"); // 한국 시간 11월 18일 12:00
const DAY = 86_400_000;

describe("시드", () => {
  beforeAll(async () => {
    await resetDb();
    await runSeed(db, { now });
  });

  it("counts", async () => {
    expect(await db.category.count()).toBe(7);
    expect(await db.instructor.count()).toBe(20);
    expect(await db.course.count({ where: { status: "published" } })).toBe(60);
    expect(await db.course.count({ where: { status: "in_review" } })).toBe(3);
    expect(await db.course.count({ where: { status: "draft" } })).toBe(1);
    expect(await db.bundle.count()).toBe(5);
    expect(await db.plan.count()).toBe(2);
    expect(await db.coupon.count()).toBe(5);
    expect(await db.notice.count()).toBe(5);
    expect(await db.faq.count()).toBe(12);
  });

  it("categories in spec order with plan codes", async () => {
    const cats = await db.category.findMany({ orderBy: { sort: "asc" } });
    expect(cats.map((c) => c.code)).toEqual(["DEV", "DATA", "CERT", "LANG", "DSGN", "BIZ", "EXAM"]);
    expect(cats[0].name).toBe("개발·프로그래밍");
  });

  it("every category has ≥ 8 published", async () => {
    const cats = await db.category.findMany({
      include: { _count: { select: { courses: { where: { status: "published" } } } } },
    });
    for (const c of cats) {
      expect(c._count.courses, c.code).toBeGreaterThanOrEqual(8);
      expect(c._count.courses, c.code).toBeLessThanOrEqual(10);
    }
  });

  it("lecture durations 300..1500", async () => {
    const agg = await db.lecture.aggregate({ _min: { duration_sec: true }, _max: { duration_sec: true } });
    expect(agg._min.duration_sec).toBeGreaterThanOrEqual(300);
    expect(agg._max.duration_sec).toBeLessThanOrEqual(1500);
  });

  it("each course ≥1 preview, ≥1 resource, 3..6 sections", async () => {
    const courses = await db.course.findMany({ include: { sections: true, lectures: true } });
    expect(courses).toHaveLength(64);
    for (const c of courses) {
      expect(c.lectures.some((l) => l.is_preview), c.code).toBe(true);
      expect(c.lectures.some((l) => l.has_resource), c.code).toBe(true);
      expect(c.sections.length, c.code).toBeGreaterThanOrEqual(3);
      expect(c.sections.length, c.code).toBeLessThanOrEqual(6);
    }
  });

  it("prices, sale, access days, subscription share", async () => {
    const pub = await db.course.findMany({ where: { status: "published" } });
    for (const c of pub) {
      expect(c.price, c.code).toBeGreaterThanOrEqual(33_000);
      expect(c.price, c.code).toBeLessThanOrEqual(198_000);
      if (c.sale_price !== null) {
        expect(c.sale_price).toBeLessThan(c.price);
        const end = c.sale_ends_at!.getTime();
        expect(end).toBeGreaterThan(now.getTime() + 3 * DAY - DAY);
        expect(end).toBeLessThanOrEqual(now.getTime() + 22 * DAY);
      }
    }
    const onSale = pub.filter((c) => c.sale_price !== null).length;
    expect(onSale).toBeGreaterThanOrEqual(15);
    expect(onSale).toBeLessThanOrEqual(25);
    const all = await db.course.findMany();
    expect(all.filter((c) => c.access_days === null)).toHaveLength(6);
    expect(all.filter((c) => c.access_days === 90)).toHaveLength(4);
    const sub = pub.filter((c) => c.in_subscription).length / pub.length;
    expect(sub).toBeGreaterThanOrEqual(0.65);
    expect(sub).toBeLessThanOrEqual(0.75);
  });

  it("fake video script: 4..8 slides, a caption every 30 seconds", async () => {
    const lectures = await db.lecture.findMany({ take: 50 });
    for (const l of lectures) {
      const s = l.script as { slides: { at: number; title: string }[]; captions: { at: number; text: string }[] };
      expect(s.slides.length).toBeGreaterThanOrEqual(4);
      expect(s.slides.length).toBeLessThanOrEqual(8);
      expect(s.slides[0].at).toBe(0);
      expect(s.captions.length).toBe(Math.ceil(l.duration_sec / 30));
      s.captions.forEach((c, i) => expect(c.at).toBe(i * 30));
    }
  });

  it("codes match /^SO-(DEV|DATA|CERT|LANG|DSGN|BIZ|EXAM)-\\d{4}$/", async () => {
    const courses = await db.course.findMany({ include: { category: true } });
    for (const c of courses) {
      expect(c.code).toMatch(/^SO-(DEV|DATA|CERT|LANG|DSGN|BIZ|EXAM)-\d{4}$/);
      expect(c.code.split("-")[1]).toBe(c.category.code);
    }
  });

  it("course counters continue after seeded codes", async () => {
    const dev = await db.course.count({ where: { category: { code: "DEV" } } });
    const counter = await db.counter.findUnique({ where: { key: "course:DEV" } });
    expect(counter?.last).toBe(dev);
  });

  it("tag 정처기실기 on 5 CERT courses", async () => {
    const tag = await db.tag.findUnique({
      where: { name: "정처기실기" },
      include: { courses: { include: { course: { include: { category: true } } } } },
    });
    expect(tag?.courses).toHaveLength(5);
    for (const t of tag!.courses) expect(t.course.category.code).toBe("CERT");
  });

  it("bundles: 3..4 published courses, 60..75% of list total", async () => {
    const bundles = await db.bundle.findMany({ include: { courses: { include: { course: true } } } });
    for (const b of bundles) {
      expect(b.courses.length).toBeGreaterThanOrEqual(3);
      expect(b.courses.length).toBeLessThanOrEqual(4);
      const sum = b.courses.reduce((s, x) => s + x.course.price, 0);
      for (const x of b.courses) expect(x.course.status).toBe("published");
      expect(b.price * 100).toBeGreaterThanOrEqual(sum * 60);
      expect(b.price * 100).toBeLessThanOrEqual(sum * 75);
      expect(b.access_days).toBe(365);
    }
  });

  it("plans and coupons use the plan's values", async () => {
    const monthly = await db.plan.findUniqueOrThrow({ where: { code: "monthly" } });
    const yearly = await db.plan.findUniqueOrThrow({ where: { code: "yearly" } });
    expect([monthly.price, monthly.refund_base_hours, monthly.interval]).toEqual([29_000, 20, "month"]);
    expect([yearly.price, yearly.refund_base_hours, yearly.interval]).toEqual([290_000, 240, "year"]);

    const welcome = await db.coupon.findUniqueOrThrow({ where: { code: "WELCOME10" } });
    expect(welcome).toMatchObject({ kind: "percent", value: 10, max_discount: 10_000, per_user_once: true });
    const d30 = await db.coupon.findUniqueOrThrow({ where: { code: "D30SALE" } });
    expect(d30).toMatchObject({ kind: "fixed", value: 5_000, target: "category", target_ref: "CERT" });
    const all = await db.coupon.findUniqueOrThrow({ where: { code: "ALLPASS20" } });
    expect(all).toMatchObject({ kind: "percent", value: 20, min_amount: 100_000 });
    const refs = await db.coupon.findMany({ where: { referral: true }, include: { instructor: true } });
    expect(refs).toHaveLength(2);
    for (const r of refs) {
      expect(r).toMatchObject({ kind: "percent", value: 10, target: "instructor" });
      expect(r.code).toBe(`REF-${r.instructor!.slug}`);
      expect(r.target_ref).toBe(r.instructor!.slug);
    }
  });

  it("live within 28 days", async () => {
    const live = await db.liveSession.findMany();
    expect(live).toHaveLength(12);
    for (const l of live) {
      expect(l.starts_at.getTime()).toBeGreaterThan(now.getTime());
      expect(l.starts_at.getTime()).toBeLessThanOrEqual(now.getTime() + 28 * DAY);
      expect(l.ends_at.getTime()).toBeGreaterThan(l.starts_at.getTime());
      expect(l.capacity).toBe(300);
    }
    expect(live.filter((l) => l.course_id)).toHaveLength(8);
    expect(live.filter((l) => !l.course_id)).toHaveLength(4);
  });

  it("faq covers refund, subscription, device, certificate, live", async () => {
    const cats = new Set((await db.faq.findMany()).map((f) => f.category));
    for (const c of ["refund", "subscription", "device", "certificate", "live"]) expect(cats.has(c), c).toBe(true);
  });

  it("ratings match the seeded reviews", async () => {
    const courses = await db.course.findMany({ where: { status: "published" }, include: { reviews: true } });
    expect(courses.some((c) => c.rating_count > 0)).toBe(true);
    for (const c of courses) {
      const shown = c.reviews.filter((r) => !r.hidden);
      expect(c.rating_count, c.code).toBe(shown.length);
      if (shown.length) {
        const avg = shown.reduce((s, r) => s + r.rating, 0) / shown.length;
        expect(c.rating_avg).toBeCloseTo(avg, 5);
      }
    }
  });

  it("idempotent", async () => {
    const count = async () => [
      await db.course.count(),
      await db.section.count(),
      await db.lecture.count(),
      await db.bundle.count(),
      await db.bundleCourse.count(),
      await db.coupon.count(),
      await db.liveSession.count(),
      await db.notice.count(),
      await db.faq.count(),
      await db.review.count(),
      await db.instructor.count(),
    ];
    const before = await count();
    const lectureIds = (await db.lecture.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((l) => l.id);
    await runSeed(db, { now });
    expect(await count()).toEqual(before);
    // 강 id가 바뀌면 진도·노트가 끊기므로 다시 돌려도 그대로여야 한다
    const again = (await db.lecture.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((l) => l.id);
    expect(again).toEqual(lectureIds);
  });

  it("no staff without env", async () => {
    expect(await db.staff.count()).toBe(0);
    expect(await db.instructorUser.count()).toBe(0);
  });

  it("no real-looking footer numbers", async () => {
    const [courses, notices, faqs, instructors, lectures] = await Promise.all([
      db.course.findMany(),
      db.notice.findMany(),
      db.faq.findMany(),
      db.instructor.findMany(),
      db.lecture.findMany({ select: { title: true } }),
    ]);
    const text = JSON.stringify([courses, notices, faqs, instructors, lectures]);
    expect(text).not.toMatch(/\d{3}-\d{2}-\d{5}/);
  });

  it("instructors carry only activity names and bios, no photos", async () => {
    for (const i of await db.instructor.findMany()) {
      expect(i.slug).toMatch(/^[a-z0-9-]+$/);
      expect(i.bio).not.toMatch(/https?:\/\//);
    }
  });
});

describe("시드 계정", () => {
  beforeAll(async () => {
    await resetDb();
    await runSeed(db, {
      now,
      staffEmail: "Admin@StudyOn.test",
      staffPassword: "seed-admin-pass",
      instructorPassword: "seed-instructor-pass",
    });
  });

  it("one admin when env is given, password hashed", async () => {
    const staff = await db.staff.findMany();
    expect(staff).toHaveLength(1);
    expect(staff[0]).toMatchObject({ email: "admin@studyon.test", role: "admin" });
    expect(staff[0].password_hash.startsWith("scrypt$")).toBe(true);
    expect(staff[0].password_hash).not.toContain("seed-admin-pass");
  });

  it("instructor accounts instructor+<slug>@studyon.test", async () => {
    const users = await db.instructorUser.findMany({ include: { instructor: true } });
    expect(users).toHaveLength(20);
    for (const u of users) expect(u.email).toBe(`instructor+${u.instructor.slug}@studyon.test`);
  });

  it("second run keeps one account each", async () => {
    await runSeed(db, { now, staffEmail: "admin@studyon.test", staffPassword: "x", instructorPassword: "y" });
    expect(await db.staff.count()).toBe(1);
    expect(await db.instructorUser.count()).toBe(20);
  });
});
