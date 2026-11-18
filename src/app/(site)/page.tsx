import Link from "next/link";
import { CourseGrid } from "@/components/CourseCard";
import { CourseThumb } from "@/components/CourseThumb";
import { DemoBadge } from "@/components/DemoBadge";
import { InstructorAvatar } from "@/components/InstructorAvatar";
import { LecturePlayer } from "@/components/LecturePlayer";
import { EXAMS, ddayLabel, examStatus } from "@/lib/exams";
import { heroClip } from "@/lib/fakevideo/clips";
import { dateKo, won } from "@/lib/format";
import { kstDate } from "@/rules/time";
import { homeSections, listCategories, subscriptionInfo } from "@/server/catalog";

export const dynamic = "force-dynamic";

const CATEGORY_HINT: Record<string, string> = {
  DEV: "파이썬, 웹, 백엔드, 클라우드",
  DATA: "SQL, 분석, 머신러닝",
  CERT: "정보처리기사, 컴활, SQLD",
  LANG: "영어회화, 토익, 일본어",
  DSGN: "피그마, UX, 포토샵",
  BIZ: "마케팅, 기획, 엑셀",
  EXAM: "수능 수학, 국어, 과학",
};

const hm = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

function Head({ title, sub, href, more }: { title: string; sub?: string; href?: string; more?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
        {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
      </div>
      {href && <Link href={href} className="shrink-0 text-sm font-semibold text-brand-600 hover:underline">{more ?? "더 보기"}</Link>}
    </div>
  );
}

/** 메인: 검색(재생 중인 강의) → 카테고리 → 이번 주 인기 → 시험 선반·기획전 → 라이브 일정 → 구독 소개 → 강사 → 공지 */
export default async function Home() {
  const now = new Date();
  const today = kstDate(now);
  const [home, categories, sub] = await Promise.all([homeSections(now), listCategories(), subscriptionInfo()]);
  const monthly = sub.plans.find((p) => p.code === "monthly");
  const yearly = sub.plans.find((p) => p.code === "yearly");
  const clip = heroClip();

  // 라이브를 날짜별로 묶는다 (한국 날짜)
  const liveDays = new Map<string, typeof home.live>();
  for (const l of home.live) {
    const d = kstDate(new Date(l.starts_at));
    liveDays.set(d, [...(liveDays.get(d) ?? []), l]);
  }

  return (
    <div>
      {/* 검색 + 재생 중인 강의 */}
      <section className="border-b border-slate-200 bg-[linear-gradient(180deg,#F1EEFF_0%,#FAFAF7_100%)]">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-[5fr_6fr] lg:py-16">
          <div>
            <h1 className="text-[2.5rem] font-black leading-[1.12] tracking-[-0.03em] text-ink sm:text-[3.25rem]">
              배움이 켜지는 곳
            </h1>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-slate-600">
              개발부터 수능까지 강의 {sub.publishedCount}개. 한 강에 5분에서 25분이라 오늘 하나는 끝낼 수 있어요.
            </p>
            <form action="/courses" role="search" className="mt-7 flex max-w-md gap-2">
              <label htmlFor="home-search" className="sr-only">강의 검색</label>
              <input
                id="home-search"
                name="q"
                type="search"
                maxLength={50}
                placeholder="정보처리기사, 파이썬, 토익"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-ink outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              />
              <button type="submit" className="btn-primary px-5">검색</button>
            </form>
            <p className="mt-3 text-xs text-slate-500">시연용 가상 서비스예요. 실제 강의를 판매하지 않아요.</p>
          </div>
          <figure className="relative">
            <div className="absolute -inset-3 -z-0 rotate-[-1.5deg] rounded-[28px] bg-lemon-400" aria-hidden="true" />
            <div className="relative overflow-hidden rounded-[22px] border-4 border-ink bg-ink shadow-[0_24px_60px_-20px_rgba(60,36,184,0.55)]">
              <div className="flex items-center gap-2 bg-ink px-4 py-2 text-xs font-semibold text-white/80">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500" aria-hidden="true" />
                지금 재생 중
              </div>
              <LecturePlayer clip={clip} label="처음 만나는 파이썬, 반복문 강의 맛보기" controls className="aspect-video w-full" testId="hero-player" />
            </div>
            <figcaption className="relative mt-4 text-sm text-slate-600">
              <Link href="/courses?q=파이썬" className="font-semibold text-ink hover:text-brand-700">처음 만나는 파이썬</Link>의 한 장면이에요. 슬라이드, 코드, 그래프가 강마다 이렇게 흘러가요.
            </figcaption>
          </figure>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-20 px-4 py-14">
        {/* 카테고리 */}
        <section aria-labelledby="cat-title">
          <h2 id="cat-title" className="sr-only">분야</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {categories.map((c) => (
              <li key={c.code}>
                <Link href={`/courses?category=${c.code}`} className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white hover:border-brand-400">
                  <CourseThumb code={`${c.code}-tile`} category={c.code} className="aspect-[16/10] w-full" />
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
          <Head title="이번 주 인기 강의" sub="최근 7일 동안 수강 신청이 많았던 순서예요. 썸네일에 마우스를 올리면 맛보기가 돌아요." href="/courses?sort=popular" />
          <CourseGrid items={home.popular} ranked />
        </section>

        {/* 시험 선반 + 기획전 */}
        <section className="rounded-[28px] bg-lemon-300/45 p-6 ring-1 ring-lemon-400/70 sm:p-8">
          <Head title="시험 달력" sub={`${dateKo(today)} 기준, 다가오는 시험과 발표까지 남은 날이에요.`} />
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {EXAMS.map((e) => {
              const st = examStatus(e, today);
              return (
                <li key={e.key}>
                  <Link href={e.href} className="relative flex h-full flex-col rounded-2xl bg-white p-5 shadow-[0_1px_0_#D6A90A] hover:ring-2 hover:ring-brand-400" data-testid="exam-ticket">
                    <span className="absolute -right-2 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-lemon-300" aria-hidden="true" />
                    <span className="absolute -left-2 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-lemon-300" aria-hidden="true" />
                    <span className="font-bold">{e.name}</span>
                    {st.state === "upcoming" ? (
                      <>
                        <span className={`mt-3 text-5xl font-black tabular-nums tracking-tight ${st.days <= 7 ? "text-rose-500" : "text-brand-600"}`}>{ddayLabel(st.days)}</span>
                        <span className="mt-2 text-sm text-slate-600">{st.milestone.label}</span>
                        <span className="text-xs text-slate-500">{dateKo(st.milestone.date, true)}</span>
                      </>
                    ) : (
                      <>
                        <span className="mt-3 text-5xl font-black tracking-tight text-slate-300">끝남</span>
                        <span className="mt-2 text-sm text-slate-600">{st.milestone.label}</span>
                        <span className="text-xs text-slate-500">{dateKo(st.milestone.date, true)}에 치렀어요</span>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-8 grid gap-6 border-t border-dashed border-lemon-600/40 pt-8 lg:grid-cols-[1fr_2fr]">
            <div>
              <p className="text-sm font-bold text-lemon-600">시즌 기획전</p>
              <h3 className="mt-1 text-2xl font-extrabold tracking-tight">{home.promo.title}</h3>
              <p className="mt-2 text-sm text-slate-700">꼭 나오는 것만 모은 강의 {home.promo.items.length}개예요. 자격증 강의는 D30SALE 쿠폰으로 5,000원 더 할인돼요.</p>
              <Link href="/courses?q=정보처리기사" className="btn-primary mt-5">기획전 강의 보기</Link>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {home.promo.items.map((c) => (
                <li key={c.code}>
                  <Link href={`/courses/${c.code}`} className="flex h-full items-center gap-3 rounded-xl bg-white p-3 hover:ring-2 hover:ring-brand-400">
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

        {/* 라이브 일정 (날짜별 시간표) */}
        <section>
          <Head title="다가오는 라이브" sub="강사와 실시간으로 묻고 답해요. 시작 10분 전부터 들어갈 수 있어요." />
          {liveDays.size ? (
            <ol className="relative space-y-6 border-l-2 border-brand-200 pl-6">
              {[...liveDays.entries()].map(([day, items]) => (
                <li key={day}>
                  <span className="absolute -left-[9px] mt-1.5 h-4 w-4 rounded-full border-4 border-paper bg-brand-500" aria-hidden="true" />
                  <p className="text-sm font-bold text-brand-700">{dateKo(day)}</p>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {items.map((l) => (
                      <li key={l.id} className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
                        <span className="w-12 shrink-0 text-lg font-extrabold tabular-nums">{hm(l.starts_at)}</span>
                        <span className="min-w-0 flex-1">
                          <Link href={`/live/${l.id}`} className="block truncate font-semibold hover:text-brand-700">{l.title}</Link>
                          <span className="flex items-center gap-1.5 text-xs text-slate-500">
                            <InstructorAvatar slug={l.instructor.slug} name={l.instructor.display_name} size={16} />
                            {l.instructor.display_name}
                            <DemoBadge className="text-[10px]" />
                          </span>
                        </span>
                        <span className={`badge shrink-0 ${l.course ? "bg-brand-50 text-brand-700 ring-brand-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>
                          {l.course ? "수강생" : "누구나"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">예정된 라이브가 없어요.</p>
          )}
        </section>

        {/* 구독 소개 */}
        <section className="grid items-center gap-8 overflow-hidden rounded-[28px] bg-brand-600 p-6 text-white sm:p-10 lg:grid-cols-[3fr_2fr]">
          <div>
            <h2 className="text-3xl font-black tracking-tight">강의 {sub.courseCount}개를 한 번에</h2>
            <p className="mt-3 max-w-lg text-white/85">구독하는 동안 구독 대상 강의를 모두 들을 수 있어요. 잠시 쉬고 싶으면 일시정지하고, 해지해도 진도는 남아요.</p>
            <Link href="/subscribe" className="btn-accent mt-6">구독 알아보기</Link>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            {monthly && (
              <div className="rounded-2xl bg-white/10 p-5">
                <dt className="text-sm text-white/75">{monthly.name}</dt>
                <dd className="mt-1 text-2xl font-black tabular-nums">{won(monthly.price)}</dd>
              </div>
            )}
            {yearly && (
              <div className="rounded-2xl bg-white p-5 text-ink">
                <dt className="text-sm text-slate-500">{yearly.name}</dt>
                <dd className="mt-1 text-2xl font-black tabular-nums">{won(yearly.price)}</dd>
                {monthly && <dd className="mt-1 text-xs font-semibold text-brand-700">월 구독보다 {won(monthly.price * 12 - yearly.price)} 아껴요</dd>}
              </div>
            )}
          </dl>
        </section>

        {/* 강사 */}
        <section>
          <Head title="수강평이 많은 강사" sub="모두 시연을 위해 만든 가상 강사예요. 그림도 이름에서 만든 추상 도형이에요." />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {home.instructors.map((i) => (
              <li key={i.slug}>
                <Link href={`/instructors/${i.slug}`} className="flex h-full gap-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200 hover:ring-2 hover:ring-brand-400" data-testid="instructor-highlight">
                  <InstructorAvatar slug={i.slug} name={i.display_name} size={64} withBadge />
                  <span className="min-w-0">
                    <span className="block text-lg font-bold">{i.display_name}</span>
                    <span className="block text-xs text-slate-500">강의 {i.course_count}개, 수강평 {i.review_count}개, 평점 {i.rating_avg.toFixed(1)}</span>
                    <span className="mt-2 line-clamp-2 block text-sm text-slate-700">{i.bio}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* 공지 */}
        <section>
          <Head title="공지사항" href="/support/notices" more="전체 공지" />
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {home.notices.map((n) => (
              <li key={n.id}>
                <Link href={`/support/notices#n-${n.id}`} className="flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-slate-50">
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
