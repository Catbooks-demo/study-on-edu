import type { Prisma, PrismaClient } from "@prisma/client";
import { addDays, kstDate, kstDateTime, kstEndOfDay } from "../src/rules/time";
import { hashPassword } from "../src/server/auth/password";
import { BUNDLES } from "./seed-data/bundles";
import { CATEGORIES } from "./seed-data/categories";
import { COUPONS } from "./seed-data/coupons";
import { COURSES, type SeedCourse } from "./seed-data/courses";
import { INSTRUCTORS } from "./seed-data/instructors";
import { LIVE } from "./seed-data/live";
import { FAQS, NOTICES } from "./seed-data/notices";
import { PLANS } from "./seed-data/plans";
import { REVIEWER_NICKS, REVIEW_BODIES } from "./seed-data/reviews";

const DAY = 86_400_000;

/** 같은 입력이면 같은 값 (0 이상 1 미만). 시드를 다시 돌려도 길이·가격이 같게. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** 키 순서와 상관없이 같은 값인지 (jsonb는 키 순서를 바꿔 저장한다). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

// ───────────────────────── 강·가짜 영상 ─────────────────────────

const SLIDE_TITLES = ["오늘 배울 것", "핵심 개념", "그림으로 보기", "예제 따라 하기", "자주 하는 실수", "직접 해 보기", "확인 문제"];
const CAPTION_LINES = [
  "먼저 오늘 다룰 내용을 짧게 훑어볼게요.",
  "화면의 예시를 같이 보면서 따라와 주세요.",
  "이 부분은 시험이나 실무에서 자주 헷갈리는 곳이에요.",
  "여기서 한 번 멈추고 직접 해 보면 좋아요.",
  "앞에서 본 개념과 어떻게 이어지는지 생각해 보세요.",
  "중요한 내용은 노트에 시점과 함께 적어 두세요.",
  "예시를 조금 바꿔서 한 번 더 볼게요.",
  "이제 다음 단계로 넘어갈게요.",
];

export interface LectureScript {
  slides: { at: number; title: string; bullets: string[] }[];
  captions: { at: number; text: string }[];
}

/** 가짜 영상 스크립트: 강 제목으로 슬라이드 4~8장, 자막은 30초마다. */
export function lectureScript(key: string, title: string, section: string, duration: number): LectureScript {
  const n = 4 + Math.floor(hash01(`${key}:slides`) * 5);
  const titles = [SLIDE_TITLES[0], ...SLIDE_TITLES.slice(1, n - 1), "정리"];
  const slides = titles.map((t, i) => ({
    at: Math.floor((i * duration) / n),
    title: i === 0 ? title : t,
    bullets: i === 0 ? [`${section} 단원`, "이번 강에서 다룰 내용"] : [`${title}: ${t}`, i === n - 1 ? "다음 강과 이어지는 내용" : "화면의 예시를 함께 봐요"],
  }));
  const captions: LectureScript["captions"] = [];
  const count = Math.ceil(duration / 30);
  for (let i = 0; i < count; i++) {
    let text = CAPTION_LINES[(i - 1 + CAPTION_LINES.length) % CAPTION_LINES.length];
    if (i === 0) text = `「${title}」 강을 시작할게요.`;
    else if (i === count - 1) text = `「${title}」 강을 정리했어요. 다음 강에서 만나요.`;
    captions.push({ at: i * 30, text });
  }
  return { slides, captions };
}

export interface PlannedLecture {
  title: string;
  sort: number; // 강의 전체에서 이어지는 순서 (1부터)
  duration_sec: number;
  is_preview: boolean;
  has_resource: boolean;
  script: LectureScript;
}

/** 커리큘럼 한 줄("섹션 | 강 | 강")을 섹션·강으로. 길이 300~1500초, 첫 강은 미리보기, 섹션 1 마지막 강은 자료 첨부. */
export function planCurriculum(code: string, cur: string[]): { title: string; sort: number; lectures: PlannedLecture[] }[] {
  let sort = 0;
  return cur.map((line, si) => {
    const [title, ...lectures] = line.split("|").map((s) => s.trim());
    return {
      title,
      sort: si + 1,
      lectures: lectures.map((lt, li) => {
        sort++;
        const key = `${code}:${sort}`;
        const duration = 300 + Math.floor(hash01(`${key}:len`) * 1201);
        const lastInSection = li === lectures.length - 1;
        return {
          title: lt,
          sort,
          duration_sec: duration,
          is_preview: sort === 1 || (sort === 2 && hash01(`${key}:pv`) < 0.3),
          has_resource: lastInSection && (si === 0 || hash01(`${key}:res`) < 0.45),
          script: lectureScript(key, lt, title, duration),
        };
      }),
    };
  });
}

/** 강의 코드: 배열 순서대로 분야마다 SO-<분야>-0001부터. */
export function courseCodes(courses: SeedCourse[] = COURSES): string[] {
  const per = new Map<string, number>();
  return courses.map((c) => {
    const n = (per.get(c.cat) ?? 0) + 1;
    per.set(c.cat, n);
    return `SO-${c.cat}-${String(n).padStart(4, "0")}`;
  });
}

async function syncCurriculum(db: PrismaClient, courseId: string, code: string, cur: string[]) {
  const plan = planCurriculum(code, cur);
  const sections = await db.section.findMany({ where: { course_id: courseId } });
  const lectures = await db.lecture.findMany({ where: { course_id: courseId } });
  const sectionBySort = new Map(sections.map((s) => [s.sort, s]));
  const lectureBySort = new Map(lectures.map((l) => [l.sort, l]));
  const creates: Prisma.LectureCreateManyInput[] = [];
  for (const s of plan) {
    let section = sectionBySort.get(s.sort);
    if (!section) section = await db.section.create({ data: { course_id: courseId, title: s.title, sort: s.sort } });
    else if (section.title !== s.title) await db.section.update({ where: { id: section.id }, data: { title: s.title } });
    for (const l of s.lectures) {
      const data = {
        section_id: section.id,
        title: l.title,
        duration_sec: l.duration_sec,
        is_preview: l.is_preview,
        has_resource: l.has_resource,
        script: l.script as unknown as Prisma.InputJsonValue,
      };
      const found = lectureBySort.get(l.sort);
      if (!found) {
        creates.push({ ...data, course_id: courseId, sort: l.sort });
        continue;
      }
      const same =
        found.section_id === data.section_id &&
        found.title === data.title &&
        found.duration_sec === data.duration_sec &&
        found.is_preview === data.is_preview &&
        found.has_resource === data.has_resource &&
        stable(found.script) === stable(l.script);
      if (!same) await db.lecture.update({ where: { id: found.id }, data });
    }
  }
  if (creates.length) await db.lecture.createMany({ data: creates });
}

// ───────────────────────── 시드 ─────────────────────────

export interface SeedOptions {
  staffEmail?: string;
  staffPassword?: string;
  instructorPassword?: string;
  now?: Date;
}

export interface SeedResult {
  categories: number;
  instructors: number;
  courses: number;
  bundles: number;
  plans: number;
  coupons: number;
  liveSessions: number;
}

/**
 * 시드: 여러 번 돌려도 결과가 같다(자연 키로 찾아 고친다).
 * 운영 중 바뀌는 값(강의 상태·공개 시각, 쿠폰 사용 수, 지난 라이브)은 처음 만들 때만 정한다.
 * 강은 (강의, 순서)로 찾아 고치므로 강 id가 그대로라 진도·노트가 끊기지 않는다.
 */
export async function runSeed(db: PrismaClient, opts: SeedOptions = {}): Promise<SeedResult> {
  const now = opts.now ?? new Date();
  const today = kstDate(now);

  // 분야
  const categoryIds = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const row = await db.category.upsert({
      where: { code: c.code },
      create: { code: c.code, name: c.name, sort: i + 1 },
      update: { name: c.name, sort: i + 1 },
    });
    categoryIds.set(c.code, row.id);
  }

  // 가상 강사 (+ 강사 화면 계정은 비밀번호가 주어졌을 때만)
  const instructorIds = new Map<string, string>();
  for (const i of INSTRUCTORS) {
    const row = await db.instructor.upsert({
      where: { slug: i.slug },
      create: { slug: i.slug, display_name: i.display_name, bio: i.bio },
      update: { display_name: i.display_name, bio: i.bio },
    });
    instructorIds.set(i.slug, row.id);
    if (opts.instructorPassword) {
      const email = `instructor+${i.slug}@studyon.test`;
      if (!(await db.instructorUser.findUnique({ where: { email } }))) {
        await db.instructorUser.create({
          data: { email, instructor_id: row.id, password_hash: await hashPassword(opts.instructorPassword) },
        });
      }
    }
  }
  const instructorId = (slug: string) => {
    const id = instructorIds.get(slug);
    if (!id) throw new Error(`강사 없음: ${slug}`);
    return id;
  };

  // 태그
  const tagIds = new Map<string, string>();
  for (const name of new Set(COURSES.flatMap((c) => c.tags ?? []))) {
    const row = await db.tag.upsert({ where: { name }, create: { name }, update: {} });
    tagIds.set(name, row.id);
  }

  // 강의
  const codes = courseCodes();
  const courseIdByTitle = new Map<string, string>();
  const publishedIds: { id: string; code: string }[] = [];
  let pub = 0;
  for (const [idx, c] of COURSES.entries()) {
    const code = codes[idx];
    const status = c.status ?? "published";
    const p = status === "published" ? pub++ : -1;
    const onSale = p >= 0 && p % 3 === 1;
    const salePrice = onSale ? Math.floor((c.price * (0.7 + hash01(`${code}:sale`) * 0.15)) / 1000) * 1000 : null;
    const saleEnds = onSale ? kstEndOfDay(addDays(today, 3 + Math.floor(hash01(`${code}:end`) * 19))) : null;
    const data = {
      title: c.title,
      subtitle: c.sub,
      category_id: categoryIds.get(c.cat)!,
      instructor_id: instructorId(c.by),
      level: c.level,
      price: c.price,
      sale_price: salePrice,
      sale_ends_at: saleEnds,
      access_days: c.access === undefined ? 365 : c.access,
      intro: c.intro,
      audience: c.aud,
      prerequisites: c.pre ?? [],
      faq: [
        { q: "수강 기간은 얼마나 되나요?", a: c.access === null ? "평생 들을 수 있어요." : `결제한 때부터 ${c.access ?? 365}일 동안 들을 수 있어요.` },
        { q: "모바일에서도 들을 수 있나요?", a: "네. 계정당 기기 2대까지 등록해 PC와 모바일에서 들을 수 있어요." },
        { q: "질문은 어디에 하나요?", a: "강마다 있는 질문 탭에 남기면 강사가 7일 안에 답해요." },
      ],
      in_subscription: p >= 0 ? p % 10 < 7 : false,
    };
    const course = await db.course.upsert({
      where: { code },
      create: {
        code,
        ...data,
        status,
        published_at: status === "published" ? new Date(now.getTime() - (10 + Math.floor(hash01(`${code}:pub`) * 300)) * DAY) : null,
      },
      update: data,
    });
    courseIdByTitle.set(c.title, course.id);
    if (status === "published") publishedIds.push({ id: course.id, code });
    if (c.tags?.length) {
      await db.courseTag.createMany({
        data: c.tags.map((t) => ({ course_id: course.id, tag_id: tagIds.get(t)! })),
        skipDuplicates: true,
      });
    }
    await syncCurriculum(db, course.id, code, c.cur);
  }

  // 일련번호가 시드 코드 다음부터 이어지게 (강사가 새 강의를 만들 때 겹치지 않게)
  const perCat = new Map<string, number>();
  for (const code of codes) {
    const cat = code.split("-")[1];
    perCat.set(cat, Math.max(perCat.get(cat) ?? 0, Number(code.split("-")[2])));
  }
  for (const [cat, last] of perCat) {
    const key = `course:${cat}`;
    await db.$executeRaw`
      INSERT INTO counters (key, last) VALUES (${key}, ${last})
      ON CONFLICT (key) DO UPDATE SET last = GREATEST(counters.last, EXCLUDED.last)`;
  }

  await seedReviews(db, publishedIds, now);

  // 패키지
  for (const b of BUNDLES) {
    const ids = b.courses.map((t) => {
      const id = courseIdByTitle.get(t);
      if (!id) throw new Error(`패키지 강의 없음: ${t}`);
      return id;
    });
    const rows = await db.course.findMany({ where: { id: { in: ids } }, select: { id: true, price: true } });
    const listTotal = rows.reduce((s, r) => s + r.price, 0);
    const price = Math.floor((listTotal * b.rate) / 1000) * 1000;
    const data = { title: b.title, summary: b.summary, price, access_days: 365 };
    const bundle = await db.bundle.upsert({ where: { code: b.code }, create: { code: b.code, ...data }, update: data });
    for (const [sort, courseId] of ids.entries()) {
      await db.bundleCourse.upsert({
        where: { bundle_id_course_id: { bundle_id: bundle.id, course_id: courseId } },
        create: { bundle_id: bundle.id, course_id: courseId, sort },
        update: { sort },
      });
    }
  }

  // 구독 플랜
  for (const p of PLANS) {
    const data = { name: p.name, interval: p.interval, price: p.price, refund_base_hours: p.refund_base_hours };
    await db.plan.upsert({ where: { code: p.code }, create: { code: p.code, ...data }, update: data });
  }

  // 쿠폰 (사용 수는 건드리지 않는다)
  for (const c of COUPONS) {
    const data = {
      name: c.name,
      kind: c.kind,
      value: c.value,
      max_discount: c.max_discount ?? null,
      min_amount: c.min_amount ?? null,
      target: c.target ?? "all",
      target_ref: c.target_ref ?? null,
      starts_at: kstDateTime(today),
      ends_at: kstEndOfDay(addDays(today, c.validDays)),
      per_user_once: c.per_user_once ?? false,
      referral: c.referral ?? false,
      instructor_id: c.instructorSlug ? instructorId(c.instructorSlug) : null,
    };
    await db.coupon.upsert({ where: { code: c.code }, create: { code: c.code, ...data }, update: data });
  }

  // 라이브 (제목이 자연 키. 이미 시작했거나 끝난 것은 그대로 둔다)
  for (const l of LIVE) {
    const starts = kstDateTime(addDays(today, l.day), l.hour);
    const data = {
      title: l.title,
      description: l.description,
      instructor_id: instructorId(l.by),
      course_id: l.course ? (courseIdByTitle.get(l.course) ?? null) : null,
      starts_at: starts,
      ends_at: new Date(starts.getTime() + l.minutes * 60_000),
      capacity: 300,
    };
    if (l.course && !data.course_id) throw new Error(`라이브 강의 없음: ${l.course}`);
    const found = await db.liveSession.findFirst({ where: { title: l.title } });
    if (!found) await db.liveSession.create({ data });
    else if (found.status === "scheduled") await db.liveSession.update({ where: { id: found.id }, data });
  }

  // 공지·FAQ
  for (const n of NOTICES) {
    const found = await db.notice.findFirst({ where: { title: n.title } });
    if (found) await db.notice.update({ where: { id: found.id }, data: n });
    else await db.notice.create({ data: n });
  }
  for (const [sort, f] of FAQS.entries()) {
    const found = await db.faq.findFirst({ where: { question: f.question } });
    if (found) await db.faq.update({ where: { id: found.id }, data: { ...f, sort } });
    else await db.faq.create({ data: { ...f, sort } });
  }

  // 직원 (환경변수가 있을 때만, 이미 있으면 비밀번호를 바꾸지 않는다)
  if (opts.staffEmail && opts.staffPassword) {
    const email = opts.staffEmail.trim().toLowerCase();
    if (!(await db.staff.findUnique({ where: { email } }))) {
      await db.staff.create({
        data: { email, name: "관리자", role: "admin", password_hash: await hashPassword(opts.staffPassword) },
      });
    }
  }

  return {
    categories: CATEGORIES.length,
    instructors: INSTRUCTORS.length,
    courses: COURSES.length,
    bundles: BUNDLES.length,
    plans: PLANS.length,
    coupons: COUPONS.length,
    liveSessions: LIVE.length,
  };
}

/** 시연용 후기: 가상 별명 계정(로그인 불가)이 강의마다 0~17개. 평점·후기 수는 숨기지 않은 후기로 다시 센다. */
async function seedReviews(db: PrismaClient, courses: { id: string; code: string }[], now: Date) {
  const reviewers: string[] = [];
  for (const [i, nick] of REVIEWER_NICKS.entries()) {
    const email = `reviewer${String(i + 1).padStart(2, "0")}@studyon.test`;
    const row = await db.user.upsert({
      where: { email },
      // 비밀번호 해시 형식이 아니라 로그인할 수 없다
      create: { email, name: nick, phone: "01000000000", password_hash: "seed-reviewer:no-login" },
      update: { name: nick },
    });
    reviewers.push(row.id);
  }
  for (const c of courses) {
    const count = Math.floor(hash01(`${c.code}:rv`) * 18);
    const quality = hash01(`${c.code}:q`);
    const start = Math.floor(hash01(`${c.code}:rs`) * reviewers.length);
    const data: Prisma.ReviewCreateManyInput[] = [];
    for (let i = 0; i < count; i++) {
      const x = hash01(`${c.code}:r${i}`);
      const good = 0.45 + quality * 0.35;
      const rating = (x < good ? 5 : x < good + 0.3 ? 4 : x < 0.95 ? 3 : x < 0.98 ? 2 : 1) as 1 | 2 | 3 | 4 | 5;
      const bodies = REVIEW_BODIES[rating];
      data.push({
        user_id: reviewers[(start + i) % reviewers.length],
        course_id: c.id,
        rating,
        body: bodies[Math.floor(hash01(`${c.code}:b${i}`) * bodies.length)],
        created_at: new Date(now.getTime() - (1 + Math.floor(hash01(`${c.code}:d${i}`) * 120)) * DAY),
      });
    }
    if (data.length) await db.review.createMany({ data, skipDuplicates: true });
  }
  const stats = await db.review.groupBy({
    by: ["course_id"],
    where: { hidden: false },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const byCourse = new Map(stats.map((s) => [s.course_id, s]));
  for (const c of courses) {
    const s = byCourse.get(c.id);
    await db.course.update({
      where: { id: c.id },
      data: { rating_avg: s?._avg.rating ?? 0, rating_count: s?._count._all ?? 0 },
    });
  }
}
