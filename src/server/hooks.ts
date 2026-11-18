import { incPayment, observeJob } from "./metrics";

/**
 * 결제·작업·구독이 운영 기능(지표·장애 주입·웹훅)에 알리는 자리.
 * 결제·작업 모듈은 이 파일만 알고, 지표·장애 주입·웹훅 모듈을 직접 부르지 않는다.
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

/** 시연용 결제 승인 실패율 (0~1). 장애 주입이 꺼져 있으면 0. (Task 21이 채운다) */
export async function paymentFailRate(): Promise<number> {
  return 0;
}

/** 구독 상태가 바뀌었을 때 (Task 25 웹훅이 채운다). */
export function onSubscriptionStatus(sub: { id: string; user_id: string }, from: string, to: string): void {
  void sub;
  void from;
  void to;
}
