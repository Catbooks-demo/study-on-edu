/** 서버가 켜질 때 한 번: 설정 검사(토스 live 키 거부·비밀값 길이). 주기 작업은 Task 9에서 여기서 시작한다. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEnv } = await import("./server/env");
  getEnv();
}
