"use client";

import { clock } from "@/lib/format";
import { RATE_OPTIONS } from "./usePlayback";

/** 재생·일시정지·탐색·배속. */
export function PlayerControls(props: {
  position: number;
  duration: number;
  playing: boolean;
  busy: boolean;
  rate: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (sec: number) => void;
  onRate: (r: number) => void;
}) {
  const { position, duration, playing, busy, rate } = props;
  return (
    <div className="flex flex-wrap items-center gap-3 bg-ink px-3 py-2 text-white">
      <button
        type="button"
        onClick={playing ? props.onPause : props.onPlay}
        disabled={busy}
        className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink disabled:opacity-60"
        aria-label={playing ? "일시정지" : "재생"}
      >
        {playing ? (
          <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden="true"><rect x="2" y="1" width="3" height="10" /><rect x="7" y="1" width="3" height="10" /></svg>
        ) : (
          <svg viewBox="0 0 12 12" className="ml-0.5 h-3.5 w-3.5" aria-hidden="true"><path d="M2 1 L11 6 L2 11 Z" /></svg>
        )}
      </button>
      <button type="button" onClick={() => props.onSeek(position - 10)} className="rounded px-1.5 py-1 text-xs text-white/80 hover:bg-white/10" aria-label="10초 뒤로">−10초</button>
      <button type="button" onClick={() => props.onSeek(position + 10)} className="rounded px-1.5 py-1 text-xs text-white/80 hover:bg-white/10" aria-label="10초 앞으로">+10초</button>
      <input
        type="range"
        min={0}
        max={duration}
        step={1}
        value={Math.floor(position)}
        onChange={(e) => props.onSeek(Number(e.target.value))}
        aria-label="재생 위치"
        className="min-w-32 flex-1 accent-lemon-500"
      />
      <span className="text-xs tabular-nums text-white/80" data-testid="player-time" data-sec={position.toFixed(1)}>
        {clock(position)} / {clock(duration)}
      </span>
      <label className="flex items-center gap-1.5 text-xs text-white/80">
        <span>배속</span>
        <select
          aria-label="배속"
          value={String(rate)}
          onChange={(e) => props.onRate(Number(e.target.value))}
          className="rounded bg-white/10 px-1.5 py-1 text-white"
        >
          {RATE_OPTIONS.map((r) => (
            <option key={r} value={String(r)} className="text-ink">{r}배</option>
          ))}
        </select>
      </label>
    </div>
  );
}
