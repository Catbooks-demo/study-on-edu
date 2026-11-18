import Link from "next/link";
import { CourseGrid } from "@/components/CourseCard";
import { CourseThumb } from "@/components/CourseThumb";
import { DemoBadge } from "@/components/DemoBadge";
import { dateTimeKo, won } from "@/lib/format";
import { homeSections, listCategories, subscriptionInfo } from "@/server/catalog";

export const dynamic = "force-dynamic";

const CATEGORY_HINT: Record<string, string> = {
  DEV: "파이썬·웹·백엔드·클라우드",
  DATA: "SQL·분석·머신러닝·AI 활용",
  CERT: "정보처리기사·컴활·SQLD",
  LANG: "영어회화·토익·일본어·중국어",
  DSGN: "피그마·UX·포토샵·모션",
  BIZ: "마케팅·기획·엑셀·재무",
  EXAM: "수능 수학·국어·영어·과학",
};

function SectionHead({ title, sub, href, more = "더 보기" }: { title: string; sub?: string; href?: string; more?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h2>
        {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
      </div>
      {href && <Link href={href} className="shrink-0 text-sm font-semibold text-brand-600 hover:underline">{more}</Link>}
    </div>
  );
}

/** 메인: 검색 → 카테고리 → 이번 주 인기 → 기획전 → 라이브 일정 → 구독 소개 → 공지 */
export default async function Home() {
  const now = new Date();
  const [home, categories, sub] = await Promise.all([homeSections(now), listCategories(), subscriptionInfo()]);
  const monthly = sub.plans.find((p) => p.code === "monthly");
  const yearly = sub.plans.find((p) => p.code === "yearly");

  return (
    <div>
      {/* 검색 */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-500 to-brand-400 text-white">
        <svg className="pointer-events-none absolute -right-16 -top-10 h-80 w-80 opacity-30" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="90" fill="#F5C518" />
        </svg>
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <p className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">시연용 가상 온라인 강의 플랫폼</p>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            배움이 켜지는 곳,<br />스터디온에듀
          </h1>
          <p className="mt-3 max-w-xl text-white/85">개발부터 수능까지, 오늘 15분이면 한 강을 끝낼 수 있어요.</p>
          <form action="/courses" role="search" className="mt-7 flex max-w-xl gap-2">
            <label htmlFor="home-search" className="sr-only">강의 검색</label>
            <input
              id="home-search"
              name="q"
              type="search"
              maxLength={50}
              placeholder="예: 정보처리기사, 파이썬, 토익"
              className="min-w-0 flex-1 rounded-xl border-0 bg-white px-4 py-3 text-ink outline-none ring-4 ring-white/20 focus:ring-lemon-400"
            />
            <button type="submit" className="btn-accent px-5">검색</button>
          </form>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-16 px-4 py-12">
        {/* 카테고리 */}
        <section aria-labelledby="cat-title">
          <h2 id="cat-title" className="sr-only">분야</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {categories.map((c) => (
              <li key={c.code}>
                <Link href={`/courses?category=${c.code}`} className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white hover:border-brand-300">
                  <CourseThumb code={`${c.code}-home`} category={c.code} className="aspect-[16/9] w-full" />
                  <span className="block px-3 pb-3 pt-2">
                    <span className="block font-bold group-hover:text-brand-700">{c.name}</span>
                    <span className="block truncate text-xs text-slate-500">{CATEGORY_HINT[c.code]}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* 이번 주 인기 */}
        <section>
          <SectionHead title="이번 주 인기 강의" sub="최근 7일 동안 수강 신청이 많았던 강의예요." href="/courses?sort=popular" />
          <CourseGrid items={home.popular} />
        </section>

        {/* 기획전 */}
        <section className="overflow-hidden rounded-3xl bg-lemon-300/40 ring-1 ring-lemon-400/60">
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_2fr]">
            <div>
              <p className="inline-flex rounded-full bg-ink px-3 py-1 text-xs font-bold text-lemon-400">시즌 기획전</p>
              <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">{home.promo.title}</h2>
              <p className="mt-2 text-sm text-slate-700">시험까지 한 달, 꼭 나오는 것만 모았어요. 자격증 강의는 <b>D30SALE</b> 쿠폰으로 5,000원 더 할인돼요.</p>
              <Link href="/courses?q=정보처리기사" className="btn-primary mt-5">기획전 강의 모두 보기</Link>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {home.promo.items.map((c) => (
                <li key={c.code}>
                  <Link href={`/courses/${c.code}`} className="flex h-full items-center gap-3 rounded-xl bg-white p-3 hover:ring-2 hover:ring-brand-300">
                    <CourseThumb code={c.code} category={c.category.code} className="h-14 w-24 shrink-0 rounded-lg" />
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm font-semibold leading-snug">{c.title}</span>
                      <span className="price text-sm">{won(c.unit)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 라이브 일정 */}
        <section>
          <SectionHead title="다가오는 라이브" sub="강사와 실시간으로 묻고 답해요. 시작 10분 전부터 들어갈 수 있어요." />
          {home.live.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {home.live.map((l) => (
                <li key={l.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="flex items-center gap-2 text-sm font-bold text-brand-700">
                    <span className="inline-block h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
                    {dateTimeKo(l.starts_at)}
                  </p>
                  <p className="font-semibold leading-snug">{l.title}</p>
                  <p className="mt-auto flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <Link href={`/instructors/${l.instructor.slug}`} className="hover:underline">{l.instructor.display_name}</Link>
                    <DemoBadge className="text-[10px]" />
                    <span>· {l.course ? "수강생 전용" : "회원 누구나"}</span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">예정된 라이브가 없어요.</p>
          )}
        </section>

        {/* 구독 소개 */}
        <section className="grid items-center gap-6 rounded-3xl bg-ink p-6 text-white sm:p-10 lg:grid-cols-[3fr_2fr]">
          <div>
            <p className="text-sm font-semibold text-lemon-400">전체 이용 구독</p>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">강의 {sub.courseCount}개를 마음껏</h2>
            <p className="mt-2 text-sm text-white/75">구독 대상 강의는 구독하는 동안 모두 들을 수 있어요. 해지해도 진도는 남아요.</p>
            <Link href="/subscribe" className="btn-accent mt-5">구독 알아보기</Link>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-center">
            {monthly && (
              <div className="rounded-2xl bg-white/10 p-4">
                <dt className="text-sm text-white/70">{monthly.name}</dt>
                <dd className="mt-1 text-xl font-extrabold">{won(monthly.price)}</dd>
              </div>
            )}
            {yearly && (
              <div className="rounded-2xl bg-white/10 p-4 ring-2 ring-lemon-400">
                <dt className="text-sm text-white/70">{yearly.name}</dt>
                <dd className="mt-1 text-xl font-extrabold">{won(yearly.price)}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* 공지 */}
        <section>
          <SectionHead title="공지사항" href="/support/notices" more="전체 공지" />
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {home.notices.map((n) => (
              <li key={n.id}>
                <Link href={`/support/notices#n-${n.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  {n.pinned && <span className="badge bg-brand-50 text-brand-700 ring-brand-200">중요</span>}
                  <span className="flex-1 truncate">{n.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
