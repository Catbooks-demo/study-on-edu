import { clock, durationKo } from "@/lib/format";
import type { CourseDetail } from "@/server/catalog";

/** 커리큘럼: 섹션 > 강 > 재생 시간, 미리보기·자료 표시. */
export function CurriculumList({ sections }: { sections: CourseDetail["sections"] }) {
  return (
    <ol className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {sections.map((s, i) => (
        <li key={s.sort}>
          <details open={i === 0} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-slate-50 px-4 py-3 hover:bg-brand-50">
              <span className="font-semibold">
                <span className="mr-2 text-brand-600">섹션 {s.sort}</span>
                {s.title}
              </span>
              <span className="shrink-0 text-xs text-slate-500">
                {s.lectures.length}강 · {durationKo(s.total_sec)}
                <span className="ml-2 inline-block transition group-open:rotate-180" aria-hidden="true">▾</span>
              </span>
            </summary>
            <ul>
              {s.lectures.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-6 shrink-0 text-xs tabular-nums text-slate-400">{l.sort}</span>
                    <span className="truncate">{l.title}</span>
                    {l.is_preview && <span className="badge bg-brand-50 text-brand-700 ring-brand-200">미리보기</span>}
                    {l.has_resource && <span className="badge bg-slate-50 text-slate-600 ring-slate-200">자료</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-500">{clock(l.duration_sec)}</span>
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ol>
  );
}
