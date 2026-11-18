import { expect, test } from "@playwright/test";

/** 가상 대기실: 사이트 대기열을 초당 1명으로 켜고 세 사람이 동시에 들어온다. */
test("waiting room admits", async ({ browser, request, baseURL }) => {
  const email = process.env.SEED_STAFF_EMAIL ?? "admin@studyon.test";
  const password = process.env.SEED_STAFF_PASSWORD ?? "e2e-admin-pass";
  const login = await request.post("/api/admin/auth/login", { data: { email, password } });
  expect(login.ok()).toBeTruthy();
  const on = await request.post("/api/admin/ops/queue", { data: { target: "site", enabled: true, rate_per_sec: 1 } });
  expect(on.ok()).toBeTruthy();
  try {
    // 설정 캐시(2초)가 지나도록 잠깐 기다린다
    await new Promise((r) => setTimeout(r, 2500));
    const contexts = await Promise.all([1, 2, 3].map(() => browser.newContext({ baseURL })));
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    const sawWaiting = pages.map(() => false);
    await Promise.all(
      pages.map(async (p, i) => {
        await p.goto("/");
        if (new URL(p.url()).pathname === "/waiting") {
          await expect(p.getByText("순서대로 들어가고 있어요")).toBeVisible();
          sawWaiting[i] = true;
        }
        await expect(p).toHaveURL(/\/$/, { timeout: 20_000 });
        await expect(p.getByRole("navigation", { name: "카테고리" })).toBeVisible();
      }),
    );
    expect(sawWaiting.some(Boolean)).toBe(true);
    await Promise.all(contexts.map((c) => c.close()));
  } finally {
    await request.post("/api/admin/ops/queue", { data: { target: "site", enabled: false, rate_per_sec: 50 } });
  }
});
