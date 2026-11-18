import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CurriculumList } from "@/components/CurriculumList";
import { DemoBadge } from "@/components/DemoBadge";
import { InstructorAvatar } from "@/components/InstructorAvatar";
import { LecturePlayer } from "@/components/LecturePlayer";
import { PriceBox } from "@/components/PriceBox";
import { RatingBars } from "@/components/RatingBars";
import { Stars } from "@/components/Stars";
import { clipFromLecture } from "@/lib/fakevideo/clips";
import { LEVEL_LABEL, accessLabel, durationKo, won } from "@/lib/format";
import { getCourse } from "@/server/catalog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await getCourse((await params).code);
  return { title: c?.title ?? "강의를 찾지 못했어요" };
}

const TABS = [
  ["intro", "소개"],
  ["curriculum", "커리큘럼"],
  ["instructor", "강사"],
  ["reviews", "수강평"],
  ["faq", "FAQ"],
  ["refund", "환불 규정"],
] as const;

export default async function CoursePage({ params }: Props) {
  const c = await getCourse((await params).code);
  if (!c) notFound();
  const clip = clipFromLecture({
    code: c.code,
    category: c.category.code,
    courseTitle: c.title,
    lectureTitle: c.preview?.title ?? c.title,
    script: c.preview?.script ?? null,
  });

  return (
    <div>
      <section className="bg-gradient-to-b from-brand-50 to-paper">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[3fr_2fr] lg:items-center">
          <div>
            <nav aria-label="위치" className="text-sm text-slate-500">
              <Link href="/courses" className="hover:underline">전체 강의</Link>
              <span className="mx-1.5">›</span>
              <Link href={`/courses?category=${c.category.code}`} className="hover:underline">{c.category.name}</Link>
            </nav>
            <h1 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">{c.title}</h1>
            <p className="mt-2 text-slate-600">{c.subtitle}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {c.rating_count > 0 && <Stars value={c.rating_avg} count={c.rating_count} size="md" />}
              <span className="flex items-center gap-1.5">
                <Link href={`/instructors/${c.instructor.slug}`} className="font-semibold text-brand-700 hover:underline">{c.instructor.display_name}</Link>
                <DemoBadge />
              </span>
            </div>
            <ul className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
              <li className="badge bg-white text-slate-700 ring-slate-200">{LEVEL_LABEL[c.level]}</li>
              <li className="badge bg-white text-slate-700 ring-slate-200">{c.lecture_count}개 강 · {durationKo(c.total_sec)}</li>
              <li className="badge bg-white text-slate-700 ring-slate-200">수강 기간 {accessLabel(c.access_days)}</li>
              {c.in_subscription && <li className="badge bg-brand-500 text-white ring-brand-500">구독 포함</li>}
              {c.tags.map((t) => <li key={t} className="badge bg-lemon-300/40 text-ink ring-lemon-400/60">#{t}</li>)}
            </ul>
          </div>
          <figure>
            <div className="overflow-hidden rounded-2xl border-4 border-ink shadow-[0_20px_50px_-20px_rgba(60,36,184,0.5)]">
              <LecturePlayer clip={clip} label={`${c.title} 맛보기`} autoPlay={false} controls className="aspect-video w-full" testId="preview-player" />
            </div>
            <figcaption className="mt-2 text-sm text-slate-600">
              <span className="font-semibold text-ink">맛보기</span> {c.preview?.title ?? "강의 미리보기"}
            </figcaption>
          </figure>
        </div>
      </section>

      <nav aria-label="강의 정보" className="sticky top-[97px] z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <ul className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-4 text-sm font-semibold text-slate-600">
          {TABS.map(([id, label]) => (
            <li key={id}><a href={`#${id}`} className="inline-block border-b-2 border-transparent py-3 hover:border-brand-500 hover:text-brand-700">{label}</a></li>
          ))}
        </ul>
      </nav>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-14">
          <section id="intro" className="scroll-mt-40">
            <h2 className="text-xl font-bold">강의 소개</h2>
            <p className="mt-3 leading-7 text-slate-700">{c.intro}</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
                <h3 className="font-semibold">이런 분께 추천해요</h3>
                <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                  {c.audience.map((a) => <li key={a} className="flex gap-2"><span className="text-brand-500">✓</span>{a}</li>)}
                </ul>
              </div>
              <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
                <h3 className="font-semibold">먼저 알면 좋아요</h3>
                <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                  {c.prerequisites.length ? c.prerequisites.map((p) => <li key={p} className="flex gap-2"><span className="text-brand-500">•</span>{p}</li>) : <li>필요한 사전 지식이 없어요.</li>}
                </ul>
              </div>
            </div>
          </section>

          <section id="curriculum" className="scroll-mt-40">
            <div className="mb-3 flex items-end justify-between">
              <h2 className="text-xl font-bold">커리큘럼</h2>
              <p className="text-sm text-slate-500">섹션 {c.sections.length}개 · {c.lecture_count}개 강 · {durationKo(c.total_sec)}</p>
            </div>
            <CurriculumList sections={c.sections} />
          </section>

          <section id="instructor" className="scroll-mt-40">
            <h2 className="text-xl font-bold">강사 소개</h2>
            <div className="mt-3 flex gap-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <InstructorAvatar slug={c.instructor.slug} name={c.instructor.display_name} size={56} />
              <div>
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/instructors/${c.instructor.slug}`} className="font-bold hover:text-brand-700">{c.instructor.display_name}</Link>
                  <DemoBadge />
                </p>
                <p className="mt-1.5 text-sm leading-6 text-slate-700">{c.instructor.bio}</p>
              </div>
            </div>
          </section>

          <section id="reviews" className="scroll-mt-40">
            <h2 className="text-xl font-bold">수강평</h2>
            <div className="mt-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <RatingBars avg={c.rating_avg} dist={c.rating_dist} />
            </div>
            {c.reviews.length ? (
              <ul className="mt-4 space-y-3">
                {c.reviews.map((r, i) => (
                  <li key={i} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                    <p className="flex items-center gap-2 text-xs text-slate-500">
                      <Stars value={r.rating} /> <span>{r.author}</span>
                    </p>
                    <p className="mt-1.5 text-sm leading-6">{r.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-500">아직 수강평이 없어요. 진도 40%를 넘기면 수강평을 쓸 수 있어요.</p>
            )}
          </section>

          <section id="faq" className="scroll-mt-40">
            <h2 className="text-xl font-bold">자주 묻는 질문</h2>
            <dl className="mt-3 divide-y divide-slate-200 rounded-2xl bg-white ring-1 ring-slate-200">
              {c.faq.map((f) => (
                <div key={f.q} className="px-5 py-4">
                  <dt className="font-semibold">Q. {f.q}</dt>
                  <dd className="mt-1 text-sm text-slate-700">{f.a}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="refund" className="scroll-mt-40">
            <h2 className="text-xl font-bold">환불 규정</h2>
            <p className="mt-1 text-sm text-slate-500">수강 기간: {accessLabel(c.access_days)}{c.access_days !== null && " (결제한 때부터)"}</p>
            <ul className="mt-3 list-disc space-y-2 rounded-2xl bg-white p-5 pl-9 text-sm leading-6 text-slate-700 ring-1 ring-slate-200">
              {c.refund_summary.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <Link href="/terms/refund" className="mt-2 inline-block text-sm font-semibold text-brand-600 hover:underline">환불 규정 전체 보기</Link>
          </section>
        </div>

        <aside className="lg:sticky lg:top-40 lg:self-start">
          <PriceBox
            unit={c.unit}
            list={c.list}
            onSale={c.onSale}
            saleEndsAt={c.sale_ends_at}
            accessDays={c.access_days}
            totalSec={c.total_sec}
            lectureCount={c.lecture_count}
            inSubscription={c.in_subscription}
            courseCode={c.code}
          />
          {c.bundles.length > 0 && (
            <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <p className="text-sm font-semibold">이 강의가 든 패키지</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {c.bundles.map((b) => (
                  <li key={b.code}>
                    <Link href={`/bundles/${b.code}`} className="flex justify-between gap-2 hover:text-brand-700">
                      <span className="truncate">{b.title}</span>
                      <span className="price shrink-0">{won(b.price)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
