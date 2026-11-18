import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CourseGrid } from "@/components/CourseCard";
import { DemoBadge } from "@/components/DemoBadge";
import { InstructorAvatar } from "@/components/InstructorAvatar";
import { dateTimeKo } from "@/lib/format";
import { getInstructorPage } from "@/server/catalog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getInstructorPage((await params).slug);
  return { title: p ? `${p.instructor.display_name} 강사` : "강사를 찾지 못했어요" };
}

export default async function InstructorPage({ params }: Props) {
  const p = await getInstructorPage((await params).slug);
  if (!p) notFound();
  const { instructor: i, stats } = p;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <section className="flex flex-col gap-6 rounded-3xl bg-white p-6 ring-1 ring-slate-200 sm:flex-row sm:items-center sm:p-8">
        <InstructorAvatar slug={i.slug} name={i.display_name} size={88} />
        <div className="flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-extrabold">
            {i.display_name} <DemoBadge />
          </h1>
          <p className="mt-2 max-w-2xl leading-7 text-slate-700">{i.bio}</p>
          <p className="mt-2 text-xs text-slate-500">시연을 위해 만든 가상 강사예요. 실제 인물이 아니에요.</p>
        </div>
        <dl className="grid grid-cols-3 gap-4 text-center sm:w-72">
          <div><dt className="text-xs text-slate-500">강의</dt><dd className="text-xl font-extrabold">{stats.course_count}</dd></div>
          <div><dt className="text-xs text-slate-500">수강평</dt><dd className="text-xl font-extrabold">{stats.review_count}</dd></div>
          <div><dt className="text-xs text-slate-500">평점</dt><dd className="text-xl font-extrabold">{stats.review_count ? stats.rating_avg.toFixed(1) : "-"}</dd></div>
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold">강의</h2>
        {p.courses.length ? <CourseGrid items={p.courses} /> : <p className="text-sm text-slate-500">공개한 강의가 아직 없어요.</p>}
      </section>

      {p.live.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">라이브 일정</h2>
          <ul className="divide-y divide-slate-200 rounded-2xl bg-white ring-1 ring-slate-200">
            {p.live.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="w-32 font-semibold text-brand-700">{dateTimeKo(l.starts_at)}</span>
                <span className="flex-1">{l.title}</span>
                {l.course && <Link href={`/courses/${l.course.code}`} className="text-xs text-slate-500 hover:underline">{l.course.title}</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
