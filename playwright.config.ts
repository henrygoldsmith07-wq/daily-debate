import { defineConfig, devices } from "@playwright/test";

// E2E for Daily Debate. testDir is scoped to tests/e2e so Playwright never
// picks up the vitest unit tests in src/lib (default testMatch would).
const PORT = Number(process.env.E2E_PORT ?? 4224);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // The production build must exist before `next start`, so build here.
  // Without E2E_DATABASE_URL the app starts in guest mode, which is the
  // failure-state surface covered by the credential-free specs.
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT} --hostname 127.0.0.1`,
    env: {
      PORT: String(PORT),
      ...(process.env.E2E_DATABASE_URL ? { DATABASE_URL: process.env.E2E_DATABASE_URL } : {}),
    },
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: "chromium",
      // E2E_BROWSER_CHANNEL lets a machine without the pinned Playwright
      // browser build run against system Chrome; CI leaves it unset.
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}),
      },
    },
  ],
});
