import type { Metadata } from "next";
import Link from "next/link";
import { CourseThumb } from "@/components/CourseThumb";
import { accessLabel, discountPct, durationKo, won } from "@/lib/format";
import { listBundles } from "@/server/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "패키지" };

export default async function BundlesPage() {
  const bundles = await listBundles();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">패키지</h1>
      <p className="mt-1 text-sm text-slate-500">순서대로 이어 듣기 좋은 강의를 묶어 더 싸게 드려요. 패키지는 강의별로 나눠 환불하지 않아요.</p>
      <ul className="mt-6 grid gap-5 md:grid-cols-2">
        {bundles.map((b) => (
          <li key={b.code}>
            <Link href={`/bundles/${b.code}`} className="flex h-full flex-col rounded-2xl bg-white p-5 ring-1 ring-slate-200 hover:ring-2 hover:ring-brand-300">
              <div className="flex -space-x-6">
                {b.courses.map((c) => (
                  <CourseThumb key={c.code} code={c.code} category={c.category.code} className="h-16 w-28 rounded-lg ring-2 ring-white" />
                ))}
              </div>
              <h2 className="mt-4 text-lg font-bold">{b.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{b.summary}</p>
              <p className="mt-2 text-xs text-slate-500">강의 {b.courses.length}개 · {durationKo(b.total_sec)} · 수강 기간 {accessLabel(b.access_days)}</p>
              <div className="mt-auto flex items-baseline gap-2 pt-4">
                <span className="text-sm font-bold text-rose-500">{discountPct(b.list_total, b.price)}%</span>
                <span className="price text-xl">{won(b.price)}</span>
                <span className="text-xs text-slate-400 line-through">{won(b.list_total)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
