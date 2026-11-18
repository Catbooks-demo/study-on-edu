"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const HEARTBEAT_SEC = Math.max(1, Number(process.env.NEXT_PUBLIC_HEARTBEAT_SEC) || 30);
const DEVICE_COOKIE = "so_device";
const TICK_MS = 200;

/** 이 브라우저의 기기 id (so_device 쿠키, 1년). 없으면 무작위로 만든다. */
export function deviceKey(): string {
  const m = document.cookie.match(/(?:^|;\s*)so_device=([A-Za-z0-9_-]{8,64})/);
  if (m) return m[1];
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  document.cookie = `${DEVICE_COOKIE}=${id}; Max-Age=${365 * 86_400}; Path=/; SameSite=Lax`;
  return id;
}

export type Notice = { kind: "elsewhere" | "device_limit" | "error"; message: string } | null;

type BeatResult = { watched_sec: number; done: boolean; course_progress: number };

/**
 * 가짜 영상 재생 상태.
 * - 실제 길이만큼 흐르고, 배속을 바꾸면 영상 시간이 그만큼 빨리 흐른다.
 * - 지난 하트비트 뒤 실제로 재생된 구간 [from, to]를 NEXT_PUBLIC_HEARTBEAT_SEC마다 보낸다.
 *   일시정지·끝·탭 가림·창 닫기 때는 sendBeacon으로 보낸다. 탐색·배속 변경 전에는 그때까지의 구간을 먼저 보낸다.
 * - 409 PLAYING_ELSEWHERE면 멈추고 안내한다. 재생을 누를 때마다 /start로 소유권을 가져온다(DEVICE_LIMIT이면 기기 관리 안내).
 */
export function usePlayback(opts: {
  lectureId: string;
  duration: number;
  resumeSec: number;
  enrolled: boolean;
  initial: { watched_sec: number; done: boolean; course_progress: number };
}) {
  const { lectureId, duration, enrolled } = opts;
  const [position, setPosition] = useState(Math.min(opts.resumeSec, duration));
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const [notice, setNotice] = useState<Notice>(null);
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState<BeatResult>(opts.initial);

  const pos = useRef(position);
  const segStart = useRef(position);
  const rateRef = useRef(rate);
  const playingRef = useRef(false);
  const lastTick = useRef(0);
  const lastBeat = useRef(0);
  const device = useRef<string>("");

  const body = useCallback(
    (from: number, to: number) => ({ lecture_id: lectureId, from_sec: from, to_sec: to, position_sec: pos.current, rate: rateRef.current, device_id: device.current || deviceKey() }),
    [lectureId],
  );

  const stop = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);

  /** 지금까지 재생된 구간을 보낸다. beacon이면 응답을 보지 않는다(창 닫기·가림). */
  const flush = useCallback(
    async (mode: "fetch" | "beacon") => {
      const from = segStart.current;
      const to = pos.current;
      segStart.current = to;
      lastBeat.current = performance.now();
      if (!enrolled) return; // 미리보기만 보는 사람은 진도를 남기지 않는다
      if (to - from < 0.5 && mode === "beacon") return;
      const payload = body(from, Math.max(from, to));
      if (mode === "beacon" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/player/heartbeat", new Blob([JSON.stringify(payload)], { type: "application/json" }));
        return;
      }
      try {
        const res = await fetch("/api/player/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "same-origin",
          keepalive: true,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setProgress({ watched_sec: data.watched_sec ?? 0, done: !!data.done, course_progress: data.course_progress ?? 0 });
          return;
        }
        const code = data?.error?.code;
        if (res.status === 409) {
          stop();
          setNotice({ kind: code === "PLAYING_ELSEWHERE" ? "elsewhere" : "error", message: data?.error?.message ?? "재생을 멈췄어요." });
        }
        // 429·일시 오류는 다음 하트비트가 다시 보낸다(구간은 이미 넘겼으니 잃는 것은 몇 초뿐)
      } catch {
        /* 네트워크 오류: 다음 하트비트에서 이어간다 */
      }
    },
    [body, enrolled, stop],
  );

  const play = useCallback(async () => {
    if (playingRef.current || starting) return;
    setStarting(true);
    setNotice(null);
    try {
      device.current = deviceKey();
      if (enrolled) {
        const res = await fetch("/api/player/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lecture_id: lectureId, device_id: device.current }),
          credentials: "same-origin",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const code = data?.error?.code;
          setNotice({ kind: code === "DEVICE_LIMIT" ? "device_limit" : "error", message: data?.error?.message ?? "잠시 후 다시 시도해 주세요." });
          return;
        }
      }
      if (pos.current >= duration - 0.05) {
        pos.current = 0;
        setPosition(0);
      }
      segStart.current = pos.current;
      lastTick.current = performance.now();
      lastBeat.current = lastTick.current;
      playingRef.current = true;
      setPlaying(true);
    } finally {
      setStarting(false);
    }
  }, [duration, enrolled, lectureId, starting]);

  const pause = useCallback(() => {
    if (!playingRef.current) return;
    stop();
    void flush("beacon");
  }, [flush, stop]);

  const seek = useCallback(
    (sec: number) => {
      const to = Math.min(duration, Math.max(0, sec));
      if (playingRef.current) void flush("fetch");
      pos.current = to;
      segStart.current = to;
      setPosition(to);
    },
    [duration, flush],
  );

  const setRate = useCallback(
    (r: number) => {
      if (playingRef.current) void flush("fetch");
      rateRef.current = r;
      setRateState(r);
    },
    [flush],
  );

  // 시계: 실제 흐른 시간 × 배속. 탭이 가려져도 setInterval은 (느리게라도) 돈다.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(5, (now - lastTick.current) / 1000);
      lastTick.current = now;
      const next = Math.min(duration, pos.current + dt * rateRef.current);
      pos.current = next;
      setPosition(next);
      if (next >= duration) {
        stop();
        void flush("fetch");
        return;
      }
      if (enrolled && now - lastBeat.current >= HEARTBEAT_SEC * 1000) void flush("fetch");
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, duration, enrolled, flush, stop]);

  // 탭 가림·창 닫기: 그때까지의 구간을 beacon으로
  useEffect(() => {
    if (!enrolled) return;
    const onHide = () => {
      if (document.visibilityState === "hidden" && playingRef.current) void flush("beacon");
    };
    const onPageHide = () => {
      if (playingRef.current) void flush("beacon");
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [enrolled, flush]);

  return { position, playing, rate, notice, starting, progress, play, pause, seek, setRate, dismiss: () => setNotice(null), heartbeatSec: HEARTBEAT_SEC };
}
