/** 답변·환불 처리 기한 (순수 함수). */
export const QUESTION_DUE_DAYS = 7;
export const REFUND_PROCESS_DAYS = 5;

const DAY_MS = 86_400_000;

/** 질문을 올린 지 7×24시간이 넘었고 아직 답이 없으면 기한 넘김. */
export function questionOverdue(created_at: Date, answered_at: Date | null, now: Date): boolean {
  return answered_at === null && now.getTime() - created_at.getTime() > QUESTION_DUE_DAYS * DAY_MS;
}

/** 환불 승인 뒤 처리 기한 (+5일). */
export function refundDueAt(approved_at: Date): Date {
  return new Date(approved_at.getTime() + REFUND_PROCESS_DAYS * DAY_MS);
}

/** 승인 뒤 5일이 지났는데 아직 처리(완료)되지 않았는지. */
export function refundOverdue(approved_at: Date, done_at: Date | null, now: Date): boolean {
  return done_at === null && now.getTime() > refundDueAt(approved_at).getTime();
}
