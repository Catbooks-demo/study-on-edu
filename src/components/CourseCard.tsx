import Link from "next/link";
import { shortTitle } from "@/lib/fakevideo/clips";
import { LEVEL_LABEL, discountPct, durationKo, won } from "@/lib/format";
import type { CourseSummary } from "@/server/catalog";
import { CourseThumb } from "./CourseThumb";
import { DemoBadge } from "./DemoBadge";
import { HoverPreview } from "./HoverPreview";
import { InstructorAvatar } from "./InstructorAvatar";
import { Stars } from "./Stars";

export function CourseCard({ c, rank }: { c: CourseSummary; rank?: number }) {
  return (
    <Link
      href={`/courses/${c.code}`}
      data-testid="course-card"
      data-hover-root
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-colors hover:border-brand-400"
    >
      <div className="relative aspect-[16/9] overflow-hidden">
        <HoverPreview code={c.code} category={c.category.code} title={c.title}>
          <CourseThumb code={c.code} category={c.category.code} title={shortTitle(c.title)} badge={durationKo(c.total_sec)} className="h-full w-full" />
        </HoverPreview>
        {rank !== undefined && (
          <span className="pointer-events-none absolute bottom-1 right-3 text-5xl font-black italic leading-none text-white [-webkit-text-stroke:2px_#10213D] [paint-order:stroke]" aria-label={`인기 ${rank}위`}>
            {rank}
          </span>
        )}
        <div className="pointer-events-none absolute right-2 top-2 flex gap-1">
          {c.in_subscription && <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-bold text-brand-700">구독</span>}
          {c.onSale && <span className="rounded-md bg-lemon-500 px-1.5 py-0.5 text-[11px] font-bold text-ink">할인</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="text-xs font-medium text-slate-500">
          {c.category.name} <span className="text-slate-300">/</span> {LEVEL_LABEL[c.level]}
        </p>
        <h3 className="line-clamp-2 font-bold leading-snug text-ink group-hover:text-brand-700">{c.title}</h3>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          <InstructorAvatar slug={c.instructor.slug} name={c.instructor.display_name} size={20} />
          {c.instructor.display_name}
          <DemoBadge className="text-[10px]" />
        </p>
        {c.rating_count > 0 ? <Stars value={c.rating_avg} count={c.rating_count} /> : <span className="text-xs text-slate-400">아직 수강평이 없어요</span>}
        <div className="mt-auto flex items-baseline gap-1.5 pt-2">
          {c.onSale && <span className="text-sm font-bold text-rose-500">{discountPct(c.list, c.unit)}%</span>}
          <span className="price text-lg">{won(c.unit)}</span>
          {c.onSale && <span className="text-xs text-slate-400 line-through">{won(c.list)}</span>}
        </div>
      </div>
    </Link>
  );
}

export function CourseGrid({ items, ranked = false }: { items: CourseSummary[]; ranked?: boolean }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((c, i) => (
        <li key={c.code} className="flex">
          <CourseCard c={c} rank={ranked ? i + 1 : undefined} />
        </li>
      ))}
    </ul>
  );
}
