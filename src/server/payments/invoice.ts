import type { Tx } from "../tx";

/**
 * 구독 청구 결제가 승인됐을 때 청구에 반영한다.
 * 지금은 청구를 paid로만 표시한다. 구독 기간·상태 반영은 Task 15가 여기에 더한다.
 */
export async function onInvoicePaid(tx: Tx, invoiceId: string, now: Date): Promise<void> {
  await tx.subscriptionInvoice.update({ where: { id: invoiceId }, data: { status: "paid", paid_at: now } });
}
