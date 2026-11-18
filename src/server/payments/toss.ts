import { getEnv } from "../env";
import { log } from "../log";

const API = "https://api.tosspayments.com/v1/payments";
const TIMEOUT_MS = 10_000;

export class TossError extends Error {
  constructor(
    public code: string,
    message: string,
    public timeout = false,
  ) {
    super(message);
  }
}

function auth(): string {
  const key = getEnv().TOSS_SECRET_KEY;
  if (!key) throw new TossError("NO_KEY", "토스 키가 없어요.");
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function post(path: string, body: unknown, idempotencyKey?: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: auth(),
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    log.warn("토스 호출 실패(시간 초과·연결)", { path, error: e instanceof Error ? e.message : String(e) });
    throw new TossError("TIMEOUT", "결제사 응답이 늦어요. 잠시 후 다시 확인해 주세요.", true);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new TossError(String(data.code ?? `HTTP_${res.status}`), String(data.message ?? "결제사에서 거절했어요."));
  }
  return data;
}

/** 결제 승인. */
export async function tossConfirm(p: { paymentKey: string; orderId: string; amount: number }) {
  return post("/confirm", p);
}

/** 결제 조회 (승인 응답이 끊겼을 때 실제로 승인됐는지 확인). */
export async function tossLookup(paymentKey: string): Promise<{ status: string; orderId: string; totalAmount: number }> {
  let res: Response;
  try {
    res = await fetch(`${API}/${encodeURIComponent(paymentKey)}`, {
      headers: { Authorization: auth() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new TossError("TIMEOUT", "결제사 조회 응답이 늦어요.", true);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new TossError(String(data.code ?? `HTTP_${res.status}`), String(data.message ?? "결제 조회 실패"));
  return { status: String(data.status ?? ""), orderId: String(data.orderId ?? ""), totalAmount: Number(data.totalAmount ?? NaN) };
}

/** 결제 취소(부분 취소 가능). 같은 환불을 두 번 보내도 한 번만 되도록 멱등 키를 쓴다. */
export async function tossCancel(paymentKey: string, cancelAmount: number, cancelReason: string, idempotencyKey: string) {
  return post(`/${encodeURIComponent(paymentKey)}/cancel`, { cancelAmount, cancelReason }, idempotencyKey);
}
