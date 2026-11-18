import { expect, test } from "@playwright/test";

const STAFF_EMAIL = process.env.SEED_STAFF_EMAIL ?? "admin@studyon.test";
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? "e2e-admin-pass";

test("staff approves refund", async ({ page }) => {
  // 수강생: API로 가입 → 담기 → 주문 → 모의 결제 → 환불 신청
  const api = page.request;
  const email = `e2e-refund-${Date.now()}@studyon.test`;
  const signup = await api.post("/api/auth/signup", {
    data: { email, password: "e2e-refund-pass", name: "환불시험", phone: "010-3456-7890", agree_terms: true, agree_privacy: true },
  });
  expect(signup.status()).toBe(201);
  expect((await api.post("/api/cart", { data: { course_code: "SO-LANG-0001" } })).status()).toBe(201);
  const order = await (await api.post("/api/orders", { data: {} })).json();
  const code: string = order.order.code;
  expect((await api.post("/api/payments/mock", { data: { code } })).ok()).toBe(true);
  const detail = await (await api.get(`/api/orders/${code}`)).json();
  const itemId: string = detail.order.items[0].id;
  const refund = await api.post("/api/refunds", { data: { order_item_id: itemId, reason: "일정이 바뀌어서 못 들어요" } });
  expect(refund.status()).toBe(201);

  // 직원: 로그인 → 환불 목록 → 그 신청
  await page.goto("/admin/refunds?status=requested");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("이메일").fill(STAFF_EMAIL);
  await page.getByLabel("비밀번호").fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin\/refunds\?status=requested/);
  await page.getByRole("link", { name: code }).click();
  await expect(page).toHaveURL(/\/admin\/refunds\/[a-z0-9]+$/);

  // 계산기: 진도 방식·경과일 방식 두 값
  await expect(page.getByTestId("calc-progress")).toHaveText(/원$/);
  await expect(page.getByTestId("calc-period")).toHaveText(/원$/);
  await expect(page.getByTestId("calc-applied")).toHaveText(/원$/);

  // 승인 → 환불 완료 (모의 결제라 바로 돌려준다)
  await page.getByRole("button", { name: "승인하기" }).click();
  await expect(page.getByTestId("refund-status")).toHaveText("환불 완료");
});
