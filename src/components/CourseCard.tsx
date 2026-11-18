import Link from "next/link";
import { LEVEL_LABEL, discountPct, durationKo, won } from "@/lib/format";
import type { CourseSummary } from "@/server/catalog";
import { CourseThumb } from "./CourseThumb";
import { DemoBadge } from "./DemoBadge";
import { Stars } from "./Stars";

export function CourseCard({ c }: { c: CourseSummary }) {
  return (
    <Link
      href={`/courses/${c.code}`}
      data-testid="course-card"
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg hover:shadow-brand-100"
    >
      <div className="relative aspect-[16/9] overflow-hidden">
        <CourseThumb code={c.code} category={c.category.code} className="h-full w-full transition duration-300 group-hover:scale-[1.03]" />
        <div className="absolute left-3 top-3 flex gap-1.5">
          {c.in_subscription && <span className="rounded-md bg-white/95 px-2 py-0.5 text-[11px] font-bold text-brand-700">구독 포함</span>}
          {c.onSale && <span className="rounded-md bg-lemon-500 px-2 py-0.5 text-[11px] font-bold text-ink">할인 중</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="text-xs font-medium text-slate-500">
          {c.category.name} · {LEVEL_LABEL[c.level]} · {durationKo(c.total_sec)}
        </p>
        <h3 className="line-clamp-2 font-bold leading-snug text-ink group-hover:text-brand-700">{c.title}</h3>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          {c.instructor.display_name} <DemoBadge className="text-[10px]" />
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

export function CourseGrid({ items }: { items: CourseSummary[] }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((c) => (
        <li key={c.code} className="flex">
          <div className="flex w-full"><CourseCard c={c} /></div>
        </li>
      ))}
    </ul>
  );
}
