import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CourseGrid } from "@/components/CourseCard";
import { PriceBox } from "@/components/PriceBox";
import { getBundle } from "@/server/catalog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const b = await getBundle((await params).code);
  return { title: b?.title ?? "패키지를 찾지 못했어요" };
}

export default async function BundlePage({ params }: Props) {
  const b = await getBundle((await params).code);
  if (!b) notFound();
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-brand-600">패키지</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{b.title}</h1>
        <p className="mt-2 text-slate-600">{b.summary}</p>
        <h2 className="mb-4 mt-8 text-xl font-bold">들어 있는 강의 {b.courses.length}개</h2>
        <CourseGrid items={b.courses} />
        <section className="mt-10 rounded-2xl bg-white p-5 text-sm leading-6 text-slate-700 ring-1 ring-slate-200">
          <h2 className="text-base font-bold text-ink">패키지 환불</h2>
          <p className="mt-1">패키지는 강의별로 나눠 환불하지 않아요. 패키지에 든 모든 강의의 진도를 합쳐 패키지 전체로 계산하고, 쿠폰을 썼다면 실제 낸 금액을 기준으로 해요.</p>
        </section>
      </div>
      <aside className="lg:sticky lg:top-40 lg:self-start">
        <PriceBox
          unit={b.price}
          list={b.list_total}
          onSale={b.price < b.list_total}
          saleEndsAt={null}
          accessDays={b.access_days}
          totalSec={b.total_sec}
          lectureCount={b.courses.reduce((a, c) => a + c.lecture_count, 0)}
          bundleCode={b.code}
        />
      </aside>
    </div>
  );
}
