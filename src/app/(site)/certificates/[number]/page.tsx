import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/CertificateButton";
import { DemoBadge } from "@/components/DemoBadge";
import { Logo } from "@/components/Logo";
import { dateKo, durationKo } from "@/lib/format";
import { kstDate } from "@/rules/time";
import { currentUser } from "@/server/auth/current";
import { getCertificate } from "@/server/certificates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "수료증" };

type Props = { params: Promise<{ number: string }> };

/** 수료증 (인쇄용). 본인 것만 볼 수 있다. 시연용 가상 서비스의 수료증이라 법적 효력이 없다고 적는다. */
export default async function CertificatePage({ params }: Props) {
  const { number } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/certificates/${number}`)}`);
  const c = await getCertificate(number, user.id);
  if (!c) notFound();
  const total = c.course.lectures.reduce((a, l) => a + l.duration_sec, 0);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <article className="relative rounded-3xl border-[10px] border-double border-brand-500 bg-white px-8 py-12 text-center shadow-sm print:shadow-none" aria-labelledby="cert-title">
        <div className="flex justify-center"><Logo /></div>
        <h1 id="cert-title" className="mt-8 text-4xl font-extrabold tracking-[0.3em]">수료증</h1>
        <p className="mt-2 font-mono text-sm text-slate-500" data-testid="certificate-number">제 {c.number} 호</p>
        <p className="mt-10 text-2xl font-bold">{c.user.name}</p>
        <p className="mx-auto mt-6 max-w-lg leading-8 text-slate-700">
          위 사람은 스터디온에듀의 「{c.course.title}」 강의(총 {durationKo(total)})를 진도율 {Math.floor(c.progress_ratio * 100)}%로 성실히 마쳤기에 이 수료증을 드려요.
        </p>
        <p className="mt-8 text-sm text-slate-600">강사 {c.course.instructor.display_name} <DemoBadge className="ml-1" /></p>
        <p className="mt-2 text-sm text-slate-600">{dateKo(kstDate(c.issued_at), true)}</p>
        <p className="mt-10 text-xs text-slate-400">스터디온에듀는 시연용 가상 서비스예요. 이 수료증은 시연용이며 법적 효력이 없어요.</p>
      </article>
      <div className="mt-6 flex justify-center"><PrintButton /></div>
    </div>
  );
}
