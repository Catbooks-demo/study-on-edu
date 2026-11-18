import { type Page, expect, test } from "@playwright/test";

const PASSWORD = "e2e-learner-pass";

async function signup(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("이름").fill("학습시험");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호 (8자 이상)").fill(PASSWORD);
  await page.getByLabel("휴대폰").fill("010-3456-7890");
  await page.getByRole("checkbox", { name: /이용약관/ }).check();
  await page.getByRole("checkbox", { name: /개인정보/ }).check();
  await page.getByRole("button", { name: "가입하기" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** 분야 첫 강의를 모의 결제로 산다. */
async function buyFirst(page: Page, category: string) {
  await page.goto(`/courses?category=${category}`);
  await page.getByTestId("course-card").first().click();
  await expect(page).toHaveURL(new RegExp(`/courses/SO-${category}-\\d{4}`));
  await page.getByRole("button", { name: "수강 신청하기" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await page.getByRole("button", { name: "주문하기" }).click();
  await expect(page).toHaveURL(/\/checkout\/SO\d{10}$/);
  await page.getByRole("checkbox", { name: /환불 규정/ }).check();
  await page.getByRole("button", { name: /모의 결제하기/ }).click();
  await expect(page).toHaveURL(/\/orders\/SO\d{10}\/done$/);
}

const num = async (page: Page, testId: string) => Number((await page.getByTestId(testId).getAttribute("data-sec")) ?? "0");

test("watch, resume, and progress grows", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const email = `e2e-learner-${Date.now()}@studyon.test`;
  await signup(page, email);
  await buyFirst(page, "DATA");

  // 내 강의실 → 플레이어
  await page.goto("/my/classroom");
  await expect(page.getByTestId("class-card")).toHaveCount(1);
  await page.getByTestId("class-card").getByRole("link", { name: /학습 시작|이어보기/ }).click();
  await expect(page).toHaveURL(/\/learn\/SO-DATA-\d{4}\/[^/]+$/);
  const playerUrl = page.url();

  // 2배속으로 약 10초 재생
  await page.getByLabel("배속").selectOption("2");
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await expect(page.getByRole("button", { name: "일시정지", exact: true })).toBeVisible();
  await page.waitForTimeout(10_000);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  expect(await num(page, "player-time")).toBeGreaterThan(12);
  await expect.poll(() => num(page, "lecture-watched"), { timeout: 10_000 }).toBeGreaterThan(0);

  // 새로고침: 서버가 기억한 진도와 이어보기 위치
  await page.reload();
  await expect.poll(() => num(page, "lecture-watched"), { timeout: 10_000 }).toBeGreaterThan(0);
  expect(await num(page, "player-time")).toBeGreaterThan(0);
  await expect(page.getByTestId("lecture-progress")).not.toHaveText("0%");

  // 다시 재생 중에 다른 기기(두 번째 브라우저 컨텍스트)에서 재생하면 첫 기기가 멈춘다
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await expect(page.getByRole("button", { name: "일시정지", exact: true })).toBeVisible();

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto("/login");
  await p2.getByLabel("이메일").fill(email);
  await p2.getByLabel("비밀번호").fill(PASSWORD);
  await p2.getByRole("button", { name: "로그인" }).click();
  await expect(p2).not.toHaveURL(/\/login/);
  await p2.goto(playerUrl);
  await p2.getByRole("button", { name: "재생", exact: true }).click();
  await expect(p2.getByRole("button", { name: "일시정지", exact: true })).toBeVisible();

  await expect(page.getByText("다른 기기에서 재생을 시작해서")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "재생", exact: true })).toBeVisible();
  await other.close();
});
