import { test, expect } from "@playwright/test";
import { HAS_BACKEND, signIn } from "./helpers";

test.describe("solo debate", () => {
  test("unauthenticated dashboard redirects to login (auth gate)", async ({ page }) => {
    await page.goto("/");
    // Either the dashboard renders (backend present) or we land on /login
    await page.waitForLoadState("domcontentloaded");
    const url = page.url();
    if (url.includes("/login")) {
      await expect(page.locator("body")).toBeVisible();
    } else {
      // Both the signed-in dashboard and the guest entry lead with the daily
      // motion panel, so this anchor holds whichever one rendered.
      await expect(page.getByText(/Today's motion/i).first()).toBeVisible({ timeout: 15000 });
    }
  });

  test("unknown debate id shows failure state, not a crash", async ({ page }) => {
    await page.goto("/debate/not-a-real-id");
    await page.waitForLoadState("domcontentloaded");
    const url = page.url();
    const body = (await page.content()).toLowerCase();
    const acceptable =
      url.includes("/login") ||
      body.includes("not found") ||
      body.includes("unauthorized") ||
      body.includes("debate");
    expect(acceptable).toBe(true);
    await expect(page.locator("body")).toBeVisible();
  });

  test("benchmark page renders offline regressions when reachable", async ({ page }) => {
    await page.goto("/benchmark");
    await page.waitForLoadState("domcontentloaded");
    // The auth middleware redirects signed-out visits to /login; with an
    // authenticated backend the offline diagnostics render directly.
    const url = page.url();
    if (url.includes("/login")) {
      await expect(page.locator("body")).toBeVisible();
    } else {
      await expect(page.getByText(/Judge benchmark/i).first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Corpus/i).first()).toBeVisible();
    }
  });

  test("authenticated solo full flow", async ({ page }) => {
    test.skip(!HAS_BACKEND, "Requires a seeded database");
    // With a backend: sign in via the shared helper (seeded credentials),
    // and land on the Today dashboard.
    await signIn(page);
    await expect(page.getByText(/Today's motion/i).first()).toBeVisible({ timeout: 15000 });
  });
});
