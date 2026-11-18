import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /queue\.spec\.ts/ },
    // 사이트 대기열을 켜는 시험은 다른 시험이 다 끝난 뒤 따로 돈다 (같은 서버를 쓰므로)
    { name: "queue", use: { ...devices["Desktop Chrome"] }, testMatch: /queue\.spec\.ts/, dependencies: ["chromium"] },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
