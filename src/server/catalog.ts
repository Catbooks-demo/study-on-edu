import type { Prisma } from "@prisma/client";
import { REFUND_RULES } from "@/lib/refund-terms";
import { effectivePrice } from "@/rules/pricing";
import type { Mode } from "@/rules/servicemode";
import { db } from "./db";

/** 강의 목록 한 쪽에 보여 줄 수. */
export const PAGE_SIZE = 24;

/** 목록 캐시 시간(초): 정상 30초, 그 밖의 모드(degraded 등)는 300초로 DB 읽기를 줄인다. */
export function listCacheTtlSec(mode: Mode = "normal"): number {
  return mode === "normal" ? 30 : 300;
}

export type Level = "beginner" | "intermediate" | "advanced";
export const LEVELS: Level[] = ["beginner", "intermediate", "advanced"];
export type CourseSort = "popular" | "newest" | "rating" | "price_asc" | "price_desc";
export const SORTS: CourseSort[] = ["popular", "newest", "rating", "price_asc", "price_desc"];

/** 이 태그가 붙은 강의가 메인 기획전에 나온다. */
export const PROMO_TAG = "정처기실기";
export const PROMO_TITLE = "정보처리기사 실기 D-30" as const;

export interface CourseSummary {
  code: string;
  title: string;
  subtitle: string;
  category: { code: string; name: string };
  instructor: { slug: string; display_name: string };
  level: Level;
  unit: number; // 지금 판매가
  list: number; // 정가
  onSale: boolean;
  sale_ends_at: string | null; // 할인 중일 때만
  rating_avg: number;
  rating_count: number;
  total_sec: number;
  lecture_count: number;
  in_subscription: boolean;
  access_days: number | null;
}

export interface CourseQuery {
  q?: string;
  category?: string;
  level?: Level;
  priceMax?: number;
  ratingMin?: number;
  inSubscription?: boolean;
  sort?: CourseSort;
  page?: number;
}

const summaryInclude = {
  category: { select: { code: true, name: true } },
  instructor: { select: { slug: true, display_name: true } },
} satisfies Prisma.CourseInclude;

type SummaryRow = Prisma.CourseGetPayload<{ include: typeof summaryInclude }>;

/** 강의별 강 수·총 길이. */
async function lectureTotals(courseIds: string[]) {
  if (!courseIds.length) return new Map<string, { sec: number; count: number }>();
  const rows = await db.lecture.groupBy({
    by: ["course_id"],
    where: { course_id: { in: courseIds } },
    _sum: { duration_sec: true },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.course_id, { sec: r._sum.duration_sec ?? 0, count: r._count._all }]));
}

function toSummary(c: SummaryRow, totals: Map<string, { sec: number; count: number }>, now: Date): CourseSummary {
  const p = effectivePrice(c, now);
  const t = totals.get(c.id);
  return {
    code: c.code,
    title: c.title,
    subtitle: c.subtitle,
    category: c.category,
    instructor: c.instructor,
    level: c.level as Level,
    unit: p.unit,
    list: c.price,
    onSale: p.onSale,
    sale_ends_at: p.onSale && c.sale_ends_at ? c.sale_ends_at.toISOString() : null,
    rating_avg: Math.round(c.rating_avg * 10) / 10,
    rating_count: c.rating_count,
    total_sec: t?.sec ?? 0,
    lecture_count: t?.count ?? 0,
    in_subscription: c.in_subscription,
    access_days: c.access_days,
  };
}

/** 공개 강의 행들을 요약으로. 순서는 그대로 둔다. */
async function summarize(rows: SummaryRow[], now: Date): Promise<CourseSummary[]> {
  const totals = await lectureTotals(rows.map((r) => r.id));
  return rows.map((r) => toSummary(r, totals, now));
}

/** 최근 7일 수강권 수 (인기순). */
async function recentEnrollments(courseIds: string[], now: Date): Promise<Map<string, number>> {
  if (!courseIds.length) return new Map();
  const rows = await db.enrollment.groupBy({
    by: ["course_id"],
    where: { course_id: { in: courseIds }, created_at: { gte: new Date(now.getTime() - 7 * 86_400_000), lte: now } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.course_id, r._count._all]));
}

/**
 * 강의 목록: 공개 강의만, 한 쪽에 24개. 판매가(할인 마감 반영)로 가격 필터·정렬을 하므로
 * 조건에 맞는 강의를 읽은 뒤 앱에서 거르고 줄 세운다(공개 강의 수가 수백 개 규모라 충분하다).
 */
export async function searchCourses(q: CourseQuery = {}, now = new Date()): Promise<{ items: CourseSummary[]; total: number }> {
  const keyword = q.q?.trim();
  const where: Prisma.CourseWhereInput = {
    status: "published",
    ...(q.category ? { category: { code: q.category } } : {}),
    ...(q.level ? { level: q.level } : {}),
    ...(q.inSubscription ? { in_subscription: true } : {}),
    ...(q.ratingMin ? { rating_avg: { gte: q.ratingMin } } : {}),
    ...(keyword
      ? {
          OR: [
            { title: { contains: keyword, mode: "insensitive" } },
            { subtitle: { contains: keyword, mode: "insensitive" } },
            { instructor: { display_name: { contains: keyword, mode: "insensitive" } } },
            { tags: { some: { tag: { name: { contains: keyword, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };
  const rows = await db.course.findMany({ where, include: summaryInclude });
  const totals = await lectureTotals(rows.map((r) => r.id));
  let list = rows.map((r) => ({ row: r, s: toSummary(r, totals, now) }));
  if (q.priceMax !== undefined) list = list.filter((x) => x.s.unit <= q.priceMax!);

  const sort = q.sort ?? "popular";
  const byCode = (a: (typeof list)[number], b: (typeof list)[number]) => a.s.code.localeCompare(b.s.code);
  if (sort === "popular") {
    const recent = await recentEnrollments(list.map((x) => x.row.id), now);
    list.sort(
      (a, b) =>
        (recent.get(b.row.id) ?? 0) - (recent.get(a.row.id) ?? 0) ||
        b.s.rating_count - a.s.rating_count ||
        byCode(a, b),
    );
  } else if (sort === "newest") {
    list.sort((a, b) => (b.row.published_at?.getTime() ?? 0) - (a.row.published_at?.getTime() ?? 0) || byCode(a, b));
  } else if (sort === "rating") {
    list.sort((a, b) => b.row.rating_avg - a.row.rating_avg || b.s.rating_count - a.s.rating_count || byCode(a, b));
  } else if (sort === "price_asc") {
    list.sort((a, b) => a.s.unit - b.s.unit || byCode(a, b));
  } else {
    list.sort((a, b) => b.s.unit - a.s.unit || byCode(a, b));
  }

  const page = Math.max(1, Math.floor(q.page ?? 1));
  return { items: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((x) => x.s), total: list.length };
}

/** 주소 쿼리를 목록 조건으로 (모르는 값은 버린다). */
export function parseCourseQuery(sp: Record<string, string | string[] | undefined>): CourseQuery {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const num = (k: string) => {
    const n = Number(one(k));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const level = one("level") as Level | undefined;
  const sort = one("sort") as CourseSort | undefined;
  return {
    q: one("q")?.slice(0, 50),
    category: one("category")?.toUpperCase(),
    level: level && LEVELS.includes(level) ? level : undefined,
    priceMax: num("priceMax"),
    ratingMin: num("ratingMin"),
    inSubscription: one("sub") === "1" || undefined,
    sort: sort && SORTS.includes(sort) ? sort : undefined,
    page: num("page"),
  };
}

// ───────────────────────── 상세 ─────────────────────────

export interface CourseDetail extends CourseSummary {
  intro: string;
  audience: string[];
  prerequisites: string[];
  faq: { q: string; a: string }[];
  tags: string[];
  instructor: { slug: string; display_name: string; bio: string };
  sections: {
    title: string;
    sort: number;
    total_sec: number;
    lectures: { id: string; title: string; sort: number; duration_sec: number; is_preview: boolean; has_resource: boolean }[];
  }[];
  rating_dist: number[]; // [1점 수, 2점 수, 3점 수, 4점 수, 5점 수]
  reviews: { rating: number; body: string; author: string; created_at: string }[];
  bundles: { code: string; title: string; price: number }[];
  refund_summary: string[];
  /** 맛보기: 첫 미리보기 강의 가짜 영상 스크립트 */
  preview: { title: string; script: { slides: { at: number; title: string; bullets: string[] }[]; captions: { at: number; text: string }[] } | null } | null;
}

/** 후기 작성자 이름 가리기: 앞 한두 글자와 끝 글자만 보인다 ("새벽공부러" → "새벽**러"). */
export function maskName(name: string): string {
  const s = [...name];
  if (s.length <= 2) return `${s[0]}*`;
  return `${s.slice(0, Math.min(2, s.length - 2)).join("")}${"*".repeat(Math.max(1, s.length - 3))}${s[s.length - 1]}`;
}

/** 강의 상세. 공개 강의가 아니면 null(미리보기는 강사·직원 화면에서만). */
export const REVIEW_SORTS = { latest: "최신순", high: "별점 높은순", low: "별점 낮은순" } as const;
export type ReviewSort = keyof typeof REVIEW_SORTS;

const REVIEW_ORDER: Record<ReviewSort, Prisma.ReviewOrderByWithRelationInput[]> = {
  latest: [{ created_at: "desc" }],
  high: [{ rating: "desc" }, { created_at: "desc" }],
  low: [{ rating: "asc" }, { created_at: "desc" }],
};

export async function getCourse(code: string, now = new Date(), opts: { reviewSort?: ReviewSort } = {}): Promise<CourseDetail | null> {
  const c = await db.course.findUnique({
    where: { code },
    include: {
      category: { select: { code: true, name: true } },
      instructor: { select: { slug: true, display_name: true, bio: true } },
      tags: { include: { tag: true } },
      sections: {
        orderBy: { sort: "asc" },
        include: { lectures: { orderBy: { sort: "asc" } } },
      },
      bundles: { include: { bundle: true } },
    },
  });
  if (!c || c.status !== "published") return null;

  const [dist, reviews] = await Promise.all([
    db.review.groupBy({ by: ["rating"], where: { course_id: c.id, hidden: false }, _count: { _all: true } }),
    db.review.findMany({
      where: { course_id: c.id, hidden: false },
      orderBy: REVIEW_ORDER[opts.reviewSort ?? "latest"],
      take: 10,
      include: { user: { select: { name: true } } },
    }),
  ]);
  const rating_dist = [1, 2, 3, 4, 5].map((r) => dist.find((d) => d.rating === r)?._count._all ?? 0);
  const lectures = c.sections.flatMap((s) => s.lectures);
  const pv = lectures.find((l) => l.is_preview);
  const pvScript = pv?.script as { slides?: unknown; captions?: unknown } | undefined;
  const totals = new Map([[c.id, { sec: lectures.reduce((a, l) => a + l.duration_sec, 0), count: lectures.length }]]);
  const base = toSummary(c, totals, now);

  return {
    ...base,
    instructor: c.instructor,
    intro: c.intro,
    audience: c.audience,
    prerequisites: c.prerequisites,
    faq: Array.isArray(c.faq) ? (c.faq as { q: string; a: string }[]) : [],
    tags: c.tags.map((t) => t.tag.name),
    sections: c.sections.map((s) => ({
      title: s.title,
      sort: s.sort,
      total_sec: s.lectures.reduce((a, l) => a + l.duration_sec, 0),
      lectures: s.lectures.map((l) => ({
        id: l.id,
        title: l.title,
        sort: l.sort,
        duration_sec: l.duration_sec,
        is_preview: l.is_preview,
        has_resource: l.has_resource,
      })),
    })),
    rating_dist,
    reviews: reviews.map((r) => ({
      rating: r.rating,
      body: r.body,
      author: maskName(r.user.name),
      created_at: r.created_at.toISOString(),
    })),
    bundles: c.bundles.filter((b) => b.bundle.active).map((b) => ({ code: b.bundle.code, title: b.bundle.title, price: b.bundle.price })),
    refund_summary: REFUND_RULES,
    preview: pv
      ? {
          title: pv.title,
          script:
            pvScript && Array.isArray(pvScript.slides) && Array.isArray(pvScript.captions)
              ? (pvScript as NonNullable<CourseDetail["preview"]>["script"])
              : null,
        }
      : null,
  };
}

// ───────────────────────── 메인·강사·라이브·패키지 ─────────────────────────

export interface LiveSummary {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  instructor: { slug: string; display_name: string };
  course: { code: string; title: string } | null;
}

/** 앞으로 열릴(또는 진행 중인) 라이브, 시작 순. */
export async function upcomingLive(now = new Date(), opts: { take?: number; instructorId?: string } = {}): Promise<LiveSummary[]> {
  const rows = await db.liveSession.findMany({
    where: {
      status: { in: ["scheduled", "live"] },
      ends_at: { gt: now },
      ...(opts.instructorId ? { instructor_id: opts.instructorId } : {}),
    },
    orderBy: { starts_at: "asc" },
    take: opts.take,
    include: {
      instructor: { select: { slug: true, display_name: true } },
      course: { select: { code: true, title: true, status: true } },
    },
  });
  return rows.map((l) => ({
    id: l.id,
    title: l.title,
    description: l.description,
    starts_at: l.starts_at.toISOString(),
    ends_at: l.ends_at.toISOString(),
    capacity: l.capacity,
    instructor: l.instructor,
    course: l.course && l.course.status === "published" ? { code: l.course.code, title: l.course.title } : null,
  }));
}

export interface InstructorHighlight {
  slug: string;
  display_name: string;
  bio: string;
  course_count: number;
  review_count: number;
  rating_avg: number;
  top: { code: string; title: string } | null;
}

/** 메인 "강사 소개": 공개 강의 수강평이 많은 강사 순. */
export async function instructorHighlights(take = 6): Promise<InstructorHighlight[]> {
  const rows = await db.instructor.findMany({
    where: { status: "active", courses: { some: { status: "published" } } },
    include: {
      courses: {
        where: { status: "published" },
        select: { code: true, title: true, rating_avg: true, rating_count: true },
        orderBy: [{ rating_count: "desc" }, { code: "asc" }],
      },
    },
  });
  return rows
    .map((i) => {
      const review_count = i.courses.reduce((a, c) => a + c.rating_count, 0);
      const sum = i.courses.reduce((a, c) => a + c.rating_avg * c.rating_count, 0);
      return {
        slug: i.slug,
        display_name: i.display_name,
        bio: i.bio,
        course_count: i.courses.length,
        review_count,
        rating_avg: review_count ? Math.round((sum / review_count) * 10) / 10 : 0,
        top: i.courses[0] ? { code: i.courses[0].code, title: i.courses[0].title } : null,
      };
    })
    .sort((a, b) => b.review_count - a.review_count || a.slug.localeCompare(b.slug))
    .slice(0, take);
}

export async function homeSections(now = new Date()) {
  const [popular, promoRows, live, notices, instructors] = await Promise.all([
    searchCourses({ sort: "popular" }, now),
    db.course.findMany({
      where: { status: "published", tags: { some: { tag: { name: PROMO_TAG } } } },
      include: summaryInclude,
      orderBy: { code: "asc" },
    }),
    upcomingLive(now, { take: 6 }),
    db.notice.findMany({ where: { published: true }, orderBy: [{ pinned: "desc" }, { created_at: "desc" }], take: 4 }),
    instructorHighlights(6),
  ]);
  return {
    popular: popular.items.slice(0, 8),
    promo: { title: PROMO_TITLE, items: await summarize(promoRows, now) },
    live,
    notices: notices.map((n) => ({ id: n.id, title: n.title, pinned: n.pinned, created_at: n.created_at.toISOString() })),
    instructors,
  };
}

/** 강사 페이지: 공개 강의·라이브·간단한 숫자. 없거나 정지된 강사면 null. */
export async function getInstructorPage(slug: string, now = new Date()) {
  const inst = await db.instructor.findUnique({ where: { slug } });
  if (!inst || inst.status !== "active") return null;
  const rows = await db.course.findMany({
    where: { instructor_id: inst.id, status: "published" },
    include: summaryInclude,
    orderBy: { published_at: "desc" },
  });
  const courses = await summarize(rows, now);
  const reviewCount = courses.reduce((a, c) => a + c.rating_count, 0);
  const ratingSum = rows.reduce((a, r) => a + r.rating_avg * r.rating_count, 0);
  return {
    instructor: { slug: inst.slug, display_name: inst.display_name, bio: inst.bio },
    courses,
    live: await upcomingLive(now, { instructorId: inst.id }),
    stats: {
      course_count: courses.length,
      review_count: reviewCount,
      rating_avg: reviewCount ? Math.round((ratingSum / reviewCount) * 10) / 10 : 0,
    },
  };
}

export interface BundleSummary {
  code: string;
  title: string;
  summary: string;
  price: number;
  list_total: number;
  access_days: number | null;
  total_sec: number;
  courses: CourseSummary[];
}

async function loadBundles(where: Prisma.BundleWhereInput, now: Date): Promise<BundleSummary[]> {
  const bundles = await db.bundle.findMany({
    where: { active: true, ...where },
    orderBy: { code: "asc" },
    include: { courses: { orderBy: { sort: "asc" }, include: { course: { include: summaryInclude } } } },
  });
  const all = bundles.flatMap((b) => b.courses.map((x) => x.course));
  const totals = await lectureTotals([...new Set(all.map((c) => c.id))]);
  return bundles.map((b) => {
    const courses = b.courses.map((x) => toSummary(x.course, totals, now));
    return {
      code: b.code,
      title: b.title,
      summary: b.summary,
      price: b.price,
      list_total: courses.reduce((a, c) => a + c.list, 0),
      access_days: b.access_days,
      total_sec: courses.reduce((a, c) => a + c.total_sec, 0),
      courses,
    };
  });
}

export async function listBundles(now = new Date()): Promise<BundleSummary[]> {
  return loadBundles({}, now);
}

export async function getBundle(code: string, now = new Date()): Promise<BundleSummary | null> {
  const [b] = await loadBundles({ code }, now);
  return b ?? null;
}

/** 구독 소개용: 판매 중인 플랜과 구독 대상 강의 수. */
export async function subscriptionInfo() {
  const [plans, count, total] = await Promise.all([
    db.plan.findMany({ where: { active: true }, orderBy: { price: "asc" } }),
    db.course.count({ where: { status: "published", in_subscription: true } }),
    db.course.count({ where: { status: "published" } }),
  ]);
  return { plans, courseCount: count, publishedCount: total };
}

/** 헤더·메인에 쓰는 분야 목록. */
export async function listCategories() {
  return db.category.findMany({ orderBy: { sort: "asc" }, select: { code: true, name: true } });
}
