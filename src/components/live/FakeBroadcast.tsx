"use client";

import { useEffect, useMemo, useState } from "react";
import { LecturePlayer } from "@/components/LecturePlayer";
import { clipForCourse, heroClip } from "@/lib/fakevideo/clips";

const two = (n: number) => String(n).padStart(2, "0");

/** 가짜 방송 화면: 가짜 영상 렌더러로 그린 화면 + LIVE 표시 + 방송 경과 시간 + 시청자 수. 실제 영상은 없다. */
export function FakeBroadcast(props: { title: string; startsAt: string; course: { code: string; category: string; title: string } | null; viewers: number }) {
  const { title, startsAt, course, viewers } = props;
  const clip = useMemo(() => (course ? clipForCourse(course) : { ...heroClip(), label: title }), [course, title]);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = now === null ? null : Math.max(0, Math.floor((now - new Date(startsAt).getTime()) / 1000));
  const before = now !== null && now < new Date(startsAt).getTime();
  return (
    <div className="relative overflow-hidden rounded-2xl bg-ink">
      <LecturePlayer clip={clip} label={`${title} (가짜 방송)`} className="aspect-video w-full" testId="live-broadcast" />
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 text-xs font-bold">
        <span className={`rounded px-2 py-0.5 text-white ${before ? "bg-slate-600" : "bg-rose-600"}`}>{before ? "곧 시작" : "LIVE"}</span>
        {elapsed !== null && !before && (
          <span className="rounded bg-black/50 px-2 py-0.5 tabular-nums text-white">
            {two(Math.floor(elapsed / 3600))}:{two(Math.floor((elapsed % 3600) / 60))}:{two(elapsed % 60)}
          </span>
        )}
      </div>
      <span className="pointer-events-none absolute right-3 top-3 rounded bg-black/50 px-2 py-0.5 text-xs font-semibold text-white" data-testid="live-viewers">
        시청 {viewers}명
      </span>
      <p className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-white/60">시연용 가짜 방송이에요</p>
    </div>
  );
}
