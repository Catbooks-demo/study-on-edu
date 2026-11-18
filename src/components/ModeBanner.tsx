import Link from "next/link";
import type { Mode } from "@/rules/servicemode";
import { MODE_MESSAGE } from "@/rules/servicemode";

/** 서비스 모드·장애 공지 배너 (사이트 맨 위). 정상이고 열린 공지가 없으면 아무것도 안 그린다. */
export function ModeBanner({ mode, incidents }: { mode: Mode; incidents: { id: string; title: string; severity: string }[] }) {
  if (mode === "normal" && incidents.length === 0) return null;
  const tone = mode === "normal" ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-lemon-100 text-slate-900 ring-lemon-300";
  return (
    <div role="status" data-testid="mode-banner" className={`ring-1 ${tone}`}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
        {mode !== "normal" && <p className="font-semibold">{MODE_MESSAGE[mode]}</p>}
        {incidents.slice(0, 2).map((i) => (
          <p key={i.id}>
            <span className="font-semibold">{i.severity === "outage" ? "장애 안내" : "지연 안내"}</span> · {i.title}
          </p>
        ))}
        <Link href="/status" className="ml-auto underline">서비스 상태 보기</Link>
      </div>
    </div>
  );
}
