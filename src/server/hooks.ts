/**
 * 지표·장애 주입 훅 자리. 지금은 아무것도 하지 않는다.
 * Task 20(지표)이 onPaymentAttempt·onJobRun을, Task 21(장애 주입)이 paymentFailRate를 채운다.
 */

/** 결제 시도 하나가 끝났을 때 (method: toss·mock). */
export function onPaymentAttempt(method: string, ok: boolean): void {
  void method;
  void ok;
}

/** 주기 작업 하나가 끝났을 때. */
export function onJobRun(name: string, ms: number, ok: boolean): void {
  void name;
  void ms;
  void ok;
}

/** 시연용 결제 승인 실패율 (0~1). 장애 주입이 꺼져 있으면 0. */
export function paymentFailRate(): number {
  return 0;
}
