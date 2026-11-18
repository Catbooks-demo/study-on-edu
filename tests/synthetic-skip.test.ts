import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeed } from "../prisma/seed-lib";
import { db } from "@/server/db";
import { backfillRunning } from "@/server/jobs";
import { HttpError } from "@/server/http";
import {
  type Ctx,
  emptyExtra,
  ensureCoupons,
  ensureStaff,
  EventQueue,
  holdBackfillLock,
  insertMembers,
  loadCourses,
  loadUserIds,
  placeIntent,
} from "../scripts/synthetic/engine";
import type { Intent } from "../scripts/synthetic/model";
import { planWindow } from "../scripts/synthetic/preview";
import { resetDb } from "./helpers/db";

// 2026-11-18 사고 재현: 되채우기가 지난 시각으로 주문을 만든 직후, 앱의 주기 작업(expireOrders)이 지금 시각으로 돌아
// 그 주문을 결제 기한 초과로 취소했고, mockPay가 409 "이미 결제했거나 취소된 주문이에요."를 던져 실행 전체가 멈췄다.
// mockPay 바로 앞에 그 주기 작업을 끼워 넣어 같은 순서를 만든다.
const hook = vi.hoisted(() => ({ mode: "none" as "none" | "expire" | "boom" }));
vi.mock("@/server/payments", async (orig) => {
  const actual = await orig<typeof import("@/server/payments")>();
  return {
    ...actual,
    mockPay: async (code: string, now?: Date) => {
      if (hook.mode === "expire") {
        const { expireOrders } = await import("@/server/jobs");
        await expireOrders(new Date()); // 앱의 주기 작업: 진짜 지금 시각
      }
      if (hook.mode === "boom") throw new Error("DB 연결이 끊김 (시험)");
      return actual.mockPay(code, now);
    },
  };
});

const now = new Date();
const lines: string[] = [];
let ctx: Ctx;
let singles: Intent[];

describe("가상 이용자: 업무 오류는 건너뛰고, 앱 주기 작업은 되채우기 동안 쉰다", () => {
  beforeAll(async () => {
    delete process.env.TOSS_CLIENT_KEY;
    delete process.env.TOSS_SECRET_KEY;
    await resetDb();
    await runSeed(db, { now });
    const { model, plans, cutoff } = planWindow(7, now, { members: 300, newMembers: 30 });
    const staffId = await ensureStaff();
    await ensureCoupons(model.windowStart);
    await insertMembers(model, () => {});
    ctx = {
      model,
      staffId,
      userIds: await loadUserIds(),
      courses: await loadCourses(),
      stats: new Map(),
      queue: new EventQueue(),
      extra: emptyExtra(),
      since: new Date(Date.now() - 1000), // 되채우기처럼 지난 시각으로 넣는다
      limit: () => cutoff,
      log: (m) => lines.push(m),
    };
    // 서로 다른 회원의 단과 결제 계획 (같은 회원이면 이미 수강 중으로 다른 갈래를 탈 수 있다)
    const seen = new Set<number>();
    singles = plans
      .flatMap((p) => p.intents)
      .filter((i) => i.kind === "single" && i.t <= cutoff && !seen.has(i.member) && (seen.add(i.member), true));
  }, 120_000);

  beforeEach(() => {
    hook.mode = "none";
    lines.length = 0;
  });

  it("주문을 만든 뒤 앱이 지금 시각으로 결제 기한 작업을 돌려 취소해도, 그 계획만 건너뛰고 멈추지 않는다", async () => {
    hook.mode = "expire";
    const intent = singles[0];
    await expect(placeIntent(ctx, { ...intent, fate: { ...intent.fate, refund: null, inquiry: null } })).resolves.toBe(false);
    const st = ctx.stats.get(intent.day)!;
    expect(st.skipped).toBe(1);
    expect(st.inserted).toBe(0);
    expect(st.followups.skipped_intent).toBe(1);
    expect(ctx.extra.skips).toEqual({ "intent:BAD_STATE": 1 });
    expect(lines.join("\n")).toContain("이미 결제했거나 취소된 주문이에요.");
    // 주문은 취소된 채 남고 결제는 승인되지 않았다
    const uid = ctx.userIds.get(intent.member)!;
    const orders = await db.order.findMany({ where: { user_id: uid } });
    expect(orders.map((o) => o.status)).toEqual(["cancelled"]);
    expect(await db.payment.count({ where: { order: { user_id: uid }, status: "approved" } })).toBe(0);
  });

  it("업무 오류가 아닌 오류는 그대로 던져 실행을 멈춘다", async () => {
    hook.mode = "boom";
    const intent = singles[1];
    const err = await placeIntent(ctx, intent).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(HttpError);
    expect((err as Error).message).toBe("DB 연결이 끊김 (시험)");
  });

  it("평소에는 그대로 결제가 들어간다", async () => {
    const intent = singles[2];
    await expect(placeIntent(ctx, { ...intent, fate: { ...intent.fate, refund: null, inquiry: null } })).resolves.toBe(true);
    const uid = ctx.userIds.get(intent.member)!;
    expect((await db.order.findFirstOrThrow({ where: { user_id: uid } })).status).toBe("paid");
  });

  it("되채우기 잠금을 잡는 동안 앱 스케줄러는 쉬고, 두 번째 되채우기는 시작하지 못한다", async () => {
    expect(await backfillRunning()).toBe(false);
    const release = await holdBackfillLock();
    try {
      expect(await backfillRunning()).toBe(true);
      await expect(holdBackfillLock()).rejects.toThrow("다른 되채우기");
    } finally {
      await release();
    }
    expect(await backfillRunning()).toBe(false);
  });
});
