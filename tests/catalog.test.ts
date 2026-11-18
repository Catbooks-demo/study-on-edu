import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../prisma/seed-lib";
import {
  PAGE_SIZE,
  getBundle,
  getCourse,
  getInstructorPage,
  homeSections,
  listBundles,
  listCacheTtlSec,
  searchCourses,
  type CourseSummary,
} from "@/server/catalog";
import { db } from "@/server/db";
import { listFaqs, listNotices } from "@/server/support";
import { resetDb } from "./helpers/db";
import { makeUser } from "./helpers/fixtures";

const now = new Date("2026-11-18T03:00:00Z");

/** 조건에 맞는 강의를 쪽을 넘기며 모두 모은다. */
async function all(q: Parameters<typeof searchCourses>[0] = {}): Promise<CourseSummary[]> {
  const out: CourseSummary[] = [];
  for (let page = 1; ; page++) {
    const r = await searchCourses({ ...q, page }, now);
    out.push(...r.items);
    if (out.length >= r.total || !r.items.length) return out;
  }
}

beforeAll(async () => {
  await resetDb();
  await runSeed(db, { now });
});

describe("강의 목록", () => {
  it("published only, 24 per page", async () => {
    const r = await searchCourses({}, now);
    expect(PAGE_SIZE).toBe(24);
    expect(r.total).toBe(60);
    expect(r.items).toHaveLength(24);
    expect((await searchCourses({ page: 3 }, now)).items).toHaveLength(12);
  });

  it("category filter", async () => {
    const items = await all({ category: "DEV" });
    expect(items.length).toBeGreaterThanOrEqual(8);
    for (const c of items) expect(c.category.code).toBe("DEV");
  });

  it("inSubscription filter", async () => {
    const items = await all({ inSubscription: true });
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(60);
    for (const c of items) expect(c.in_subscription).toBe(true);
  });

  it("level, price and rating filters", async () => {
    for (const c of await all({ level: "beginner" })) expect(c.level).toBe("beginner");
    for (const c of await all({ priceMax: 60_000 })) expect(c.unit).toBeLessThanOrEqual(60_000);
    for (const c of await all({ ratingMin: 4.5 })) expect(c.rating_avg).toBeGreaterThanOrEqual(4.5);
  });

  it("keyword search matches title, subtitle or instructor", async () => {
    const items = await all({ q: "정보처리기사" });
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const c of items) expect(`${c.title} ${c.subtitle} ${c.instructor.display_name}`).toContain("정보처리기사");
  });

  it("price_asc sorted", async () => {
    const items = await all({ sort: "price_asc" });
    expect(items).toHaveLength(60);
    for (let i = 1; i < items.length; i++) expect(items[i].unit).toBeGreaterThanOrEqual(items[i - 1].unit);
    const desc = await all({ sort: "price_desc" });
    for (let i = 1; i < desc.length; i++) expect(desc[i].unit).toBeLessThanOrEqual(desc[i - 1].unit);
  });

  it("rating sort is descending", async () => {
    const items = await all({ sort: "rating" });
    for (let i = 1; i < items.length; i++) expect(items[i].rating_avg).toBeLessThanOrEqual(items[i - 1].rating_avg);
  });

  it("summary price uses the sale only before it ends", async () => {
    const onSale = (await all()).filter((c) => c.onSale);
    expect(onSale.length).toBeGreaterThan(0);
    for (const c of onSale) {
      expect(c.unit).toBeLessThan(c.list);
      expect(new Date(c.sale_ends_at!).getTime()).toBeGreaterThan(now.getTime());
    }
    const later = new Date(now.getTime() + 30 * 86_400_000);
    const r = await searchCourses({ page: 1 }, later);
    for (const c of r.items) expect(c.onSale).toBe(false);
  });

  it("popular counts enrollments of the last 7 days", async () => {
    const target = (await all({ sort: "price_asc" }))[59];
    const course = await db.course.findUniqueOrThrow({ where: { code: target.code } });
    for (let i = 0; i < 3; i++) {
      const u = await makeUser();
      await db.enrollment.create({
        data: { user_id: u.id, course_id: course.id, source: "free", starts_at: now, created_at: new Date(now.getTime() - 86_400_000) },
      });
    }
    const top = (await searchCourses({ sort: "popular" }, now)).items[0];
    expect(top.code).toBe(target.code);
    await db.enrollment.deleteMany({ where: { course_id: course.id } });
  });

  it("unpublished hidden", async () => {
    const hidden = await db.course.findMany({ where: { status: { not: "published" } } });
    expect(hidden.length).toBe(4);
    const codes = new Set((await all()).map((c) => c.code));
    for (const c of hidden) {
      expect(codes.has(c.code)).toBe(false);
      expect(await getCourse(c.code, now)).toBeNull();
    }
    expect(await getCourse("SO-DEV-9999", now)).toBeNull();
  });

  it("list cache ttl is 30 seconds for now", () => {
    expect(listCacheTtlSec()).toBe(30);
  });
});

describe("강의 상세", () => {
  it("detail curriculum", async () => {
    const [first] = (await searchCourses({ category: "DEV" }, now)).items;
    const d = await getCourse(first.code, now);
    expect(d).not.toBeNull();
    const course = await db.course.findUniqueOrThrow({
      where: { code: first.code },
      include: { sections: { orderBy: { sort: "asc" }, include: { lectures: { orderBy: { sort: "asc" } } } } },
    });
    expect(d!.sections.map((s) => s.title)).toEqual(course.sections.map((s) => s.title));
    d!.sections.forEach((s, i) => {
      expect(s.lectures.map((l) => l.title)).toEqual(course.sections[i].lectures.map((l) => l.title));
    });
    const sum = course.sections.flatMap((s) => s.lectures).reduce((a, l) => a + l.duration_sec, 0);
    expect(d!.total_sec).toBe(sum);
    expect(d!.lecture_count).toBe(course.sections.flatMap((s) => s.lectures).length);
    expect(d!.sections.flatMap((s) => s.lectures).some((l) => l.is_preview)).toBe(true);
    expect(d!.instructor.slug).toBeTruthy();
    expect(d!.refund_summary.length).toBeGreaterThan(0);
  });

  it("rating distribution sums to rating_count", async () => {
    for (const c of (await searchCourses({ sort: "rating" }, now)).items.slice(0, 10)) {
      const d = await getCourse(c.code, now);
      expect(d!.rating_dist).toHaveLength(5);
      expect(d!.rating_dist.reduce((a, b) => a + b, 0)).toBe(d!.rating_count);
    }
  });
});

describe("메인·강사·패키지·고객센터", () => {
  it("home sections", async () => {
    const h = await homeSections(now);
    expect(h.popular.length).toBeGreaterThanOrEqual(4);
    expect(h.promo.title).toBe("정보처리기사 실기 D-30");
    expect(h.promo.items).toHaveLength(5);
    for (const c of h.promo.items) expect(c.category.code).toBe("CERT");
    expect(h.live.length).toBeGreaterThan(0);
    for (let i = 1; i < h.live.length; i++) {
      expect(new Date(h.live[i].starts_at).getTime()).toBeGreaterThanOrEqual(new Date(h.live[i - 1].starts_at).getTime());
    }
    expect(h.notices.length).toBeGreaterThan(0);
  });

  it("instructor page lists only published courses", async () => {
    const inst = await db.instructor.findFirstOrThrow({ where: { courses: { some: { status: "in_review" } } } });
    const p = await getInstructorPage(inst.slug, now);
    expect(p).not.toBeNull();
    expect(p!.courses.length).toBeGreaterThan(0);
    const codes = await db.course.findMany({ where: { instructor_id: inst.id, status: "published" }, select: { code: true } });
    expect(p!.courses.map((c) => c.code).sort()).toEqual(codes.map((c) => c.code).sort());
    expect(await getInstructorPage("no-such-teacher", now)).toBeNull();
  });

  it("bundles show list total and saving", async () => {
    const list = await listBundles(now);
    expect(list).toHaveLength(5);
    const b = await getBundle(list[0].code, now);
    expect(b).not.toBeNull();
    expect(b!.list_total).toBe(b!.courses.reduce((s, c) => s + c.list, 0));
    expect(b!.price).toBeLessThan(b!.list_total);
  });

  it("notices pinned first, faqs by category", async () => {
    const notices = await listNotices();
    expect(notices).toHaveLength(5);
    const firstUnpinned = notices.findIndex((n) => !n.pinned);
    if (firstUnpinned >= 0) expect(notices.slice(firstUnpinned).every((n) => !n.pinned)).toBe(true);
    const faqs = await listFaqs();
    expect(faqs).toHaveLength(12);
    expect((await listFaqs("refund")).every((f) => f.category === "refund")).toBe(true);
  });
});
