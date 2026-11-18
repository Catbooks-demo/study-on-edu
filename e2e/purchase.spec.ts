import { expect, test } from "@playwright/test";

test("signup, buy with coupon, see classroom, preview refund", async ({ page }) => {
  const email = `e2e-buyer-${Date.now()}@studyon.test`;

  // 가입
  await page.goto("/signup");
  await page.getByLabel("이름").fill("구매시험");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호 (8자 이상)").fill("e2e-buyer-pass");
  await page.getByLabel("휴대폰").fill("010-2345-6789");
  await page.getByRole("checkbox", { name: /이용약관/ }).check();
  await page.getByRole("checkbox", { name: /개인정보/ }).check();
  await page.getByRole("button", { name: "가입하기" }).click();
  await expect(page).toHaveURL(/\/$/);

  // 강의 상세 → 장바구니
  await page.goto("/courses?category=DEV");
  await page.getByTestId("course-card").first().click();
  await expect(page).toHaveURL(/\/courses\/SO-DEV-\d{4}/);
  await page.getByRole("button", { name: "수강 신청하기" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByTestId("cart-line")).toHaveCount(1);

  // 주문서: WELCOME10 → 환불 규정 동의 → 모의 결제
  await page.getByRole("button", { name: "주문하기" }).click();
  await expect(page).toHaveURL(/\/checkout\/SO\d{10}$/);
  const before = await page.getByTestId("checkout-payable").textContent();
  await page.getByLabel("쿠폰 번호").fill("WELCOME10");
  await page.getByRole("button", { name: "적용" }).click();
  await expect(page.getByText(/WELCOME10 쿠폰으로/)).toBeVisible();
  await expect(page.getByTestId("checkout-payable")).not.toHaveText(before ?? "");
  await page.getByRole("checkbox", { name: /환불 규정/ }).check();
  await page.getByRole("button", { name: /모의 결제하기/ }).click();

  // 완료 화면
  await expect(page).toHaveURL(/\/orders\/SO\d{10}\/done$/);
  await expect(page.getByRole("heading", { name: "결제가 완료됐어요" })).toBeVisible();
  const code = (await page.getByTestId("order-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^SO\d{10}$/);

  // 내 강의실
  await page.getByRole("link", { name: "내 강의실" }).click();
  await expect(page).toHaveURL(/\/my$/);
  await expect(page.getByTestId("classroom-course")).toHaveCount(1);

  // 마이페이지 주문 → 환불 신청 미리 보기: 7일 이내·진도 0이라 예상 환불액 = 결제액
  await page.goto("/my/orders");
  await page.getByRole("link", { name: code }).click();
  await expect(page).toHaveURL(new RegExp(`/my/orders/${code}$`));
  const paid = (await page.getByTestId("item-paid").first().textContent())?.trim();
  await page.getByRole("button", { name: "환불 신청" }).first().click();
  await expect(page.getByText("예상 환불액")).toBeVisible();
  await expect(page.getByTestId("refund-estimate")).toHaveText(paid ?? "");
});
