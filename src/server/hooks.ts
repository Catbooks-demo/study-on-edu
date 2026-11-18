import type { Order, User } from "@prisma/client";
import { incPayment, observeJob } from "./metrics";
import type { Tx } from "./tx";
import { memberV1 } from "./v1/serialize";
import { emitEvent, emitSubscriptionStatus } from "./webhooks";

/**
 * 결제·작업·구독·서비스 모드가 운영 기능(지표·웹훅)에 알리는 자리.
 * 결제·작업 모듈은 이 파일만 알고, 지표·웹훅 모듈을 직접 부르지 않는다.
 */

/** 결제 시도 하나가 끝났을 때 (method: toss·mock). */
export function onPaymentAttempt(method: string, ok: boolean): void {
  incPayment(method, ok);
}

/** 주기 작업 하나가 끝났을 때. */
export function onJobRun(name: string, ms: number, ok: boolean): void {
  void ok;
  observeJob(name, ms);
}

/**
 * 결제 승인 실패율 (0~1). 장애 주입은 M7에서 뺐으므로 늘 0이다
 * (시연 장애는 팀이 직접 만든다). M3 chargeMockInvoice가 부르는 자리만 남겨 둔다.
 */
export function paymentFailRate(): number {
  return 0;
}

/** 구독 상태가 바뀌었을 때 (같은 트랜잭션 안: 웹훅 subscription.status_changed가 커밋과 함께 쌓인다). */
export async function onSubscriptionStatus(tx: Tx, sub: { id: string; user_id: string }, from: string, to: string): Promise<void> {
  if (from === to) return;
  await emitSubscriptionStatus(tx, sub, from, to);
}

/** 서비스 모드가 바뀌었을 때 (같은 트랜잭션: 웹훅 service_mode.changed). */
export async function onModeChanged(tx: Tx, change: { from: string; to: string; reason: string; at: Date }): Promise<void> {
  await emitEvent(tx, "service_mode.changed", { from: change.from, to: change.to, reason: change.reason, at: change.at.toISOString() }, change.at);
}

/** 주문 결제가 반영됐을 때 (같은 트랜잭션: 웹훅 order.paid, 개인정보는 가림). */
export async function onOrderPaid(tx: Tx, order: Order, user: User, amount: number, now: Date): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { order_id: order.id }, include: { course: true, bundle: true }, orderBy: { created_at: "asc" } });
  await emitEvent(
    tx,
    "order.paid",
    {
      order_code: order.code,
      member: memberV1(user, false),
      payable: order.payable,
      paid_amount: amount,
      paid_at: (order.paid_at ?? now).toISOString(),
      items: items.map((i) => ({ kind: i.kind, course_code: i.course?.code ?? null, bundle_code: i.bundle?.code ?? null, paid_amount: i.paid_amount })),
    },
    now,
  );
}

/** 주문 환불이 끝났을 때 (같은 트랜잭션: 웹훅 order.refunded). */
export async function onOrderRefunded(
  tx: Tx,
  order: Order,
  user: User,
  refund: { refund_id: string; order_item_id: string; amount: number },
  now: Date,
): Promise<void> {
  await emitEvent(
    tx,
    "order.refunded",
    { order_code: order.code, order_status: order.status, member: memberV1(user, false), ...refund, refunded_total: order.refunded_amount, at: now.toISOString() },
    now,
  );
}
