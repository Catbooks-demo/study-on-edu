"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Clip, H, W, composeFrame } from "@/lib/fakevideo/frame";
import { paint } from "@/lib/fakevideo/paint";
import { Poster } from "@/lib/fakevideo/Poster";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
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
 * 플레이어 화면: 같은 가짜 영상 렌더러(composeFrame)를 재생 위치(time)로 그린다.
 * 시계는 usePlayback이 가진다. 움직임 줄이기면 1초 단위 SVG 정지 화면으로 그린다.
 */
export function FakeVideo({ clip, time, label }: { clip: Clip; time: number; label: string }) {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef(1);
  const t = Math.max(0, time - 0.001);
  const stillT = Math.floor(t);
  const still = useMemo(() => (reduced ? composeFrame(clip, stillT) : null), [reduced, clip, stillT]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (reduced || !canvas) return;
    const scale = Math.min(2, window.devicePixelRatio || 1) * (canvas.clientWidth / W || 1);
    scaleRef.current = scale;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
  }, [reduced]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (reduced || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const raf = requestAnimationFrame(() => paint(ctx, composeFrame(clip, t), scaleRef.current));
    return () => cancelAnimationFrame(raf);
  }, [clip, t, reduced]);

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-[#0B2A55]">
      {reduced && still ? (
        <Poster ops={still} label={label} className="block h-full w-full" testId="player-poster" />
      ) : (
        <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={label} data-testid="player-canvas" />
      )}
    </div>
  );
}
