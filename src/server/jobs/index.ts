import { log } from "../log";
import { runJobsOnce } from "./tasks";

const EVERY_MS = 60_000;
let started = false;

/** 앱 안 스케줄러: 60초마다 주기 작업. 여러 앱이 떠도 작업마다 DB 잠금으로 한 번에 하나만 돈다. */
export function startScheduler(): void {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      const r = await runJobsOnce();
      if (Object.values(r).some((n) => n > 0)) log.info("주기 작업", r);
    } catch (e) {
      log.error("주기 작업 실패", { error: e instanceof Error ? e.message : String(e) });
    }
  };
  setTimeout(tick, 10_000).unref?.();
  setInterval(tick, EVERY_MS).unref?.();
  log.info("주기 작업 시작", { every_sec: EVERY_MS / 1000 });
}

export { withJobLock } from "./lock";
export { JOBS, expireOrders, retryRefunds, runJobsOnce } from "./tasks";
