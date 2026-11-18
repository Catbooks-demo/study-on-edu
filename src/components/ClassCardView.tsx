import Link from "next/link";
import { CertificateButton } from "@/components/CertificateButton";
import { CourseThumb } from "@/components/CourseThumb";
import { DemoBadge } from "@/components/DemoBadge";
import { kstDate } from "@/rules/time";
import type { ClassCard } from "@/server/classroom";

const pct = (r: number) => `${Math.floor(r * 100)}%`;

/** 내 강의실 카드: 진도율·이어보기·수료증. */
export function ClassCardView({ c, kind }: { c: ClassCard; kind: "active" | "completed" | "expired" }) {
  const target = c.resume?.lecture_id ?? c.first_lecture_id;
  return (
    <li data-testid="class-card" className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
      <Link href={`/courses/${c.course_code}`} className="block">
        <CourseThumb code={c.course_code} category={c.category} title={c.title} className="aspect-video w-full" />
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-brand-600">{c.instructor} <DemoBadge /></p>
        <p className="mt-0.5 line-clamp-2 font-semibold">{c.title}</p>
        <div className="mt-3">
          <div className="flex justify-between text-xs text-slate-500">
            <span>진도율</span>
            <span className="tabular-nums" data-testid="class-progress">{pct(c.progress_ratio)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="진도율" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(c.progress_ratio * 100)}>
            <div className="h-full bg-brand-500" style={{ width: pct(c.progress_ratio) }} />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {kind === "expired"
            ? c.expires_at ? `${kstDate(new Date(c.expires_at))}에 수강 기간이 끝났어요` : "지금은 볼 수 없어요 (구독 일시정지·종료)"
            : c.expires_at ? `${kstDate(new Date(c.expires_at))}까지` : c.source === "subscription" ? "구독 중" : "평생 수강"}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          {kind !== "expired" && target && (
            <Link href={`/learn/${c.course_code}/${target}`} className="btn-primary px-3 py-1.5 text-sm">{c.resume ? "이어보기" : "학습 시작"}</Link>
          )}
          {kind === "expired" && <Link href={`/courses/${c.course_code}`} className="btn-line px-3 py-1.5 text-sm">강의 다시 보기</Link>}
          {c.certificate ? (
            <Link href={`/certificates/${c.certificate}`} className="btn-line px-3 py-1.5 text-sm">수료증 보기</Link>
          ) : (
            kind === "completed" && <CertificateButton courseCode={c.course_code} />
          )}
        </div>
      </div>
    </li>
  );
}
