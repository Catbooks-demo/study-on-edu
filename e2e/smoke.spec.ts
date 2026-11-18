import { expect, test } from "@playwright/test";

test("home shows brand and demo footer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("스터디온에듀").first()).toBeVisible();
  await expect(page.getByText("시연용 가상 서비스예요").first()).toBeVisible();
});
