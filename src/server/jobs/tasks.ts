import { db } from "../db";
import { advanceLiveStatus } from "../live";
import { log } from "../log";
import { cancelPendingOrder, lockOrder } from "../orders";
import { reconcilePending } from "../payments";
import { settleRefund, stuckRefundIds } from "../refunds";
import { endSubscriptions, renewSubscriptions, resumePaused, retryFailedInvoices } from "../subscriptions";
import { withJobLock } from "./lock";

/**
 * 결제 기한(30분)이 지난 pending 주문을 cancelled로 (쿠폰 기록도 풀린다).
 * 토스에 승인을 보내 결과를 기다리는 결제가 있는 주문은 다음 차례로 미룬다(reconcilePending이 먼저 정리한다).
 */
export async function expireOrders(now: Date): Promise<number> {
  const overdue = await db.order.findMany({
    where: {
      status: "pending",
      expires_at: { lt: now },
      payments: { none: { status: "pending", method: "toss", toss_payment_key: { not: null } } },
    },
    select: { id: true },
  });
  let n = 0;
  for (const { id } of overdue) {
    const changed = await db.$transaction(async (tx) => {
      const o = await lockOrder(tx, { id });
      if (o.status !== "pending" || o.expires_at >= now) return false;
      return cancelPendingOrder(tx, id, "결제 기한(30분)이 지나 주문이 취소됐어요. 쿠폰은 다시 쓸 수 있어요.");
    });
    if (changed) n++;
  }
  return n;
}

/** 결제사 실패로 approved에 남은 환불을 다시 돌려준다. done이 된 수. */
export async function retryRefunds(now: Date): Promise<number> {
  let n = 0;
  for (const id of await stuckRefundIds()) {
    const r = await settleRefund(id, now);
    if (r.status === "done") n++;
  }
  return n;
}

/** 작업 목록 (이 순서로 돈다). 이후 작업(구독 갱신·정산·웹훅 등)은 여기에 더한다. */
export const JOBS: Record<string, (now: Date) => Promise<number>> = {
  reconcilePending,
  expireOrders,
  retryRefunds,
  // 구독: 정지가 풀린 것을 먼저 살리고, 해지 예약을 끝낸 뒤 갱신·재시도
  resumePaused,
  endSubscriptions,
  renewSubscriptions,
  retryFailedInvoices,
  advanceLiveStatus,
};

/**
 * 주기 작업 한 번. 작업마다 따로 잠금을 잡으므로 하나가 다른 곳에서 돌고 있어도 나머지는 돈다.
 * 돌았던 작업만 결과에 넣는다(이름 → 처리한 수).
 */
export async function runJobsOnce(now: Date = new Date()): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, job] of Object.entries(JOBS)) {
    try {
      const r = await withJobLock(name, () => job(now));
      if (r !== null) out[name] = r;
    } catch (e) {
      log.error("주기 작업 실패", { job: name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
