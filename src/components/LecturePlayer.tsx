"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Clip, H, W, clipDuration, composeFrame, posterTime } from "@/lib/fakevideo/frame";
import { paint } from "@/lib/fakevideo/paint";
import { Poster } from "@/lib/fakevideo/Poster";

/** 사용자가 "움직임 줄이기"를 켰는지. 서버와 첫 그림에서는 켠 것으로 보고 포스터를 그린다. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * 가짜 영상 재생기: 클립을 canvas에 30fps로 그린다. 화면 밖이거나 탭이 가려지면 멈춘다.
 * 움직임 줄이기면 정지 포스터(SVG)만 보여 준다. 플레이어(Task 12)도 같은 렌더러를 쓴다.
 */
export function LecturePlayer({
  clip,
  label,
  autoPlay = true,
  controls = false,
  className = "",
  testId,
}: {
  clip: Clip;
  label: string;
  autoPlay?: boolean;
  controls?: boolean;
  className?: string;
  testId?: string;
}) {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(autoPlay);
  const [progress, setProgress] = useState(0);
  const total = clipDuration(clip);
  const poster = useMemo(() => composeFrame(clip, posterTime(clip)), [clip]);
  const animate = !reduced && playing;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (reduced || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = Math.min(2, window.devicePixelRatio || 1) * (canvas.clientWidth / W || 1);
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    let raf = 0;
    let last = 0;
    let visible = true;
    let t = posterTime(clip);
    let prev = performance.now();
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    if (boxRef.current) io.observe(boxRef.current);
    paint(ctx, composeFrame(clip, t), scale);
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      if (animate && visible && !document.hidden) {
        t = (t + dt) % total;
        if (now - last > 33) {
          last = now;
          paint(ctx, composeFrame(clip, t), scale);
          if (controls) setProgress(t / total);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [clip, reduced, animate, total, controls]);

  return (
    <div ref={boxRef} className={controls ? "bg-ink" : "h-full w-full"} data-testid={testId}>
      <div className={`relative overflow-hidden bg-[#0B2A55] ${className}`}>
        {reduced ? (
          <Poster ops={poster} label={`${label} (정지 화면)`} className="block h-full w-full" />
        ) : (
          <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} data-testid="preview-canvas" />
        )}
      </div>
      {controls && (
        <div className="flex items-center gap-3 px-3 py-2">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            disabled={reduced}
            className="grid h-8 w-8 place-items-center rounded-full bg-white text-ink disabled:opacity-60"
            aria-label={animate ? "일시정지" : "재생"}
          >
            {animate ? (
              <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true"><rect x="2" y="1" width="3" height="10" /><rect x="7" y="1" width="3" height="10" /></svg>
            ) : (
              <svg viewBox="0 0 12 12" className="ml-0.5 h-3 w-3" aria-hidden="true"><path d="M2 1 L11 6 L2 11 Z" /></svg>
            )}
          </button>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
            <span className="block h-full bg-lemon-500" style={{ width: `${(reduced ? posterTime(clip) / total : progress) * 100}%` }} />
          </span>
          <span className="text-xs tabular-nums text-white/80">{Math.round(total)}초</span>
        </div>
      )}
    </div>
  );
}
