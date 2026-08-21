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
  // Placeholder Supabase env keeps the edge middleware's client construction
  // happy; every auth check then resolves to "signed out", which is the
  // failure-state surface this suite asserts.
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT} --hostname 127.0.0.1`,
    env: {
      PORT: String(PORT),
      NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? "e2e-placeholder-anon-key",
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
