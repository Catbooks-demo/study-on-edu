import Link from "next/link";
import { clock } from "@/lib/format";
import type { PlayerInfo } from "@/server/player";

/** 커리큘럼 사이드바: 섹션·강, 완료 표시, 지금 강. */
export function CurriculumSidebar({ courseCode, sections, currentId, enrolled }: { courseCode: string; sections: PlayerInfo["sections"]; currentId: string; enrolled: boolean }) {
  return (
    <nav aria-label="커리큘럼" className="max-h-[70vh] overflow-y-auto rounded-2xl bg-white ring-1 ring-slate-200">
      {sections.map((s) => (
        <div key={s.sort}>
          <p className="sticky top-0 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600">{s.title}</p>
          <ul>
            {s.lectures.map((l) => {
              const open = enrolled || l.is_preview;
              const current = l.id === currentId;
              const inner = (
                <>
                  <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${l.done ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                    {l.done ? "✓" : l.sort}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{l.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400">{clock(l.duration_sec)}</span>
                  {l.done && <span className="sr-only">(완료)</span>}
                </>
              );
              return (
                <li key={l.id}>
                  {open ? (
                    <Link
                      href={`/learn/${courseCode}/${l.id}`}
                      aria-current={current ? "page" : undefined}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-brand-50 ${current ? "bg-brand-50 font-semibold text-brand-700" : ""}`}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <span className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-400">{inner}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
