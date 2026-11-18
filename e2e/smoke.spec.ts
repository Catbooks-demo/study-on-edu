import { expect, test } from "@playwright/test";

test("home shows brand and demo footer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("스터디온에듀").first()).toBeVisible();
  await expect(page.getByText("시연용 가상 서비스예요").first()).toBeVisible();
});

test("browse to course detail", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "카테고리" }).getByRole("link", { name: "개발·프로그래밍" }).click();
  await expect(page).toHaveURL(/\/courses\?category=DEV/);
  await page.getByTestId("course-card").first().click();
  await expect(page).toHaveURL(/\/courses\/SO-DEV-\d{4}/);
  await expect(page.getByRole("heading", { name: "커리큘럼" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "환불 규정" })).toBeVisible();
  await expect(page.getByText("시연용 가상 강사").first()).toBeVisible();
});

test("terms pages linked from signup exist", async ({ page }) => {
  for (const [path, title] of [
    ["/terms/service", "이용약관"],
    ["/terms/privacy", "개인정보 처리방침"],
    ["/terms/refund", "환불 규정"],
  ] as const) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  }
});
