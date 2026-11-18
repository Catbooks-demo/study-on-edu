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

test.describe("generated media", () => {
  test("hero plays on canvas; reduced motion shows a static poster", async ({ page, browser }) => {
    await page.goto("/");
    await expect(page.getByTestId("hero-player").getByTestId("preview-canvas")).toBeVisible();
    await expect(page.getByTestId("exam-ticket")).toHaveCount(4);
    await expect(page.getByTestId("instructor-highlight").first()).toContainText("시연용 가상 강사");

    const reduced = await browser.newContext({ reducedMotion: "reduce" });
    const p2 = await reduced.newPage();
    await p2.goto("/");
    await expect(p2.getByTestId("hero-player").getByTestId("preview-poster")).toBeVisible();
    await expect(p2.getByTestId("hero-player").locator("canvas")).toHaveCount(0);
    await reduced.close();
  });

  test("card hover starts a short preview loop", async ({ page }) => {
    await page.goto("/courses?category=DEV");
    const card = page.getByTestId("course-card").first();
    await card.hover();
    await expect(card.getByTestId("card-preview").locator("canvas")).toBeVisible();
  });

  test("course detail 맛보기 player plays", async ({ page }) => {
    await page.goto("/courses?category=DATA");
    await page.getByTestId("course-card").first().click();
    const player = page.getByTestId("preview-player");
    await expect(player.getByTestId("preview-canvas")).toBeVisible();
    await player.getByRole("button", { name: "재생" }).click();
    await expect(player.getByRole("button", { name: "일시정지" })).toBeVisible();
  });

  test("main page screenshot", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: "screens/home.png", fullPage: true });
  });
});
