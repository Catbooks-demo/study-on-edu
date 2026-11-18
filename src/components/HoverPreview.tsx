"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clipForCourse } from "@/lib/fakevideo/clips";
import { LecturePlayer } from "./LecturePlayer";

/**
 * 강의 카드에 마우스를 올리거나 키보드로 고르면 썸네일 자리에서 짧은 맛보기 클립이 돈다.
 * 카드 전체([data-hover-root])의 hover·focus를 듣는다. 올렸을 때만 canvas를 만들어 목록이 가볍다.
 */
export function HoverPreview({ code, category, title, children }: { code: string; category: string; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>("[data-hover-root]") ?? ref.current;
    if (!root) return;
    const enter = () => setOn(true);
    const leave = () => setOn(false);
    root.addEventListener("mouseenter", enter);
    root.addEventListener("mouseleave", leave);
    root.addEventListener("focus", enter);
    root.addEventListener("blur", leave);
    return () => {
      root.removeEventListener("mouseenter", enter);
      root.removeEventListener("mouseleave", leave);
      root.removeEventListener("focus", enter);
      root.removeEventListener("blur", leave);
    };
  }, []);
  const clip = useMemo(() => (on ? clipForCourse({ code, category, title }) : null), [on, code, category, title]);
  return (
    <div ref={ref} className="relative h-full w-full">
      {children}
      {clip && (
        <div className="absolute inset-0" data-testid="card-preview">
          <LecturePlayer clip={clip} label={`${title} 맛보기`} className="h-full w-full" />
        </div>
      )}
    </div>
  );
}
