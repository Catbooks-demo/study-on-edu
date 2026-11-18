import { onSubscriptionStatus } from "../hooks";
import { recordMessage, won } from "../messages";
import type { Tx } from "../tx";

const kstDay = (d: Date) => d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

/**
 * 구독 청구 결제가 승인됐을 때 (청구 행은 부르는 쪽이 이미 잠갔다).
 * 청구를 paid로 하고, 구독을 active로 바꾸며 현재 기간을 그 청구 기간으로 맞춘다.
 * 재시도 결제가 성공해도 새 기간은 청구 기간(= 원래 기간 끝에서 시작)이다. 실패 횟수·재시도 시각은 지운다.
 */
export async function onInvoicePaid(tx: Tx, invoiceId: string, now: Date): Promise<void> {
  const inv = await tx.subscriptionInvoice.update({ where: { id: invoiceId }, data: { status: "paid", paid_at: now } });
  await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${inv.subscription_id} FOR UPDATE`;
  const sub = await tx.subscription.findUniqueOrThrow({ where: { id: inv.subscription_id }, include: { user: true, plan: true } });
  const paidBefore = await tx.subscriptionInvoice.count({
    where: { subscription_id: sub.id, id: { not: inv.id }, status: { in: ["paid", "refunded"] } },
  });
  await tx.subscription.update({
    where: { id: sub.id },
    data: {
      status: "active",
      current_period_start: inv.period_start,
      current_period_end: inv.period_end,
      failure_count: 0,
      first_failed_at: null,
      next_retry_at: null,
      cancelled_at: null,
    },
  });
  const until = kstDay(inv.period_end);
  if (paidBefore === 0) {
    await recordMessage(
      tx, sub.user, "subscription_started", "구독 시작",
      `${sub.plan.name}을 시작했어요. 구독 대상 강의를 마음껏 들어 보세요. (결제 ${won(inv.amount)} · 이번 기간 ${until}까지)`,
    );
  } else if (sub.status === "past_due") {
    await recordMessage(
      tx, sub.user, "subscription_recovered", "구독 결제 완료",
      `밀렸던 구독 결제가 끝났어요. 구독이 다시 정상이에요. (결제 ${won(inv.amount)} · 이번 기간 ${until}까지)`,
    );
  } else {
    await recordMessage(
      tx, sub.user, "subscription_renewed", "구독 갱신",
      `구독이 자동으로 갱신됐어요. (결제 ${won(inv.amount)} · 이번 기간 ${until}까지)`,
    );
  }
  if (sub.status !== "active") await onSubscriptionStatus(tx, sub, sub.status, "active");
}
