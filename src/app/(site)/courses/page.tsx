import type { Metadata } from "next";
import Link from "next/link";
import { CourseGrid } from "@/components/CourseCard";
import { FilterBar } from "@/components/FilterBar";
import { withQuery } from "@/lib/nav";
import { PAGE_SIZE, listCategories, parseCourseQuery, searchCourses } from "@/server/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "강의 목록" };

type SP = Record<string, string | string[] | undefined>;

export default async function CoursesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const q = parseCourseQuery(await searchParams);
  const [result, categories] = await Promise.all([searchCourses(q), listCategories()]);
  const cat = categories.find((c) => c.code === q.category);
  const title = q.q ? `‘${q.q}’ 검색 결과` : cat ? cat.name : "전체 강의";
  const page = q.page ?? 1;
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const href = (p: number) =>
    withQuery("/courses", {
      q: q.q, category: q.category, level: q.level, priceMax: q.priceMax, ratingMin: q.ratingMin,
      sub: q.inSubscription, sort: q.sort, page: p > 1 ? p : undefined,
    });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        <p className="text-sm text-slate-500">강의 {result.total}개</p>
      </div>
      <FilterBar q={q} categories={categories} />
      <div className="mt-6">
        {result.items.length ? (
          <CourseGrid items={result.items} />
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="font-semibold">조건에 맞는 강의가 없어요.</p>
            <p className="mt-1 text-sm text-slate-500">조건을 줄이거나 다른 말로 검색해 보세요.</p>
            <Link href="/courses" className="btn-line mt-4">전체 강의 보기</Link>
          </div>
        )}
      </div>
      {pages > 1 && (
        <nav aria-label="쪽 이동" className="mt-8 flex justify-center gap-1">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={href(p)}
              aria-current={p === page ? "page" : undefined}
              className={`min-w-10 rounded-lg px-3 py-2 text-center text-sm font-semibold ${p === page ? "bg-brand-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-brand-300"}`}
            >
              {p}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
