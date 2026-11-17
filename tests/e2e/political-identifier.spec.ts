import { test, expect } from "@playwright/test";

// The political identifier reads stored positions; it makes no AI call. CI
// runs without Postgres credentials, so an unauthenticated visit is redirected
// to /login. With a seeded backend the page renders its honest low-sample state
// or the ledger. Either way it must not crash.

test.describe("political identifier", () => {
  test("renders or auth-gates without crashing", async ({ page }) => {
    await page.goto("/political-identifier");
    await page.waitForLoadState("domcontentloaded");
    const url = page.url();
    const body = (await page.content()).toLowerCase();
    const acceptable =
      url.includes("/login") ||
      body.includes("political identifier") ||
      body.includes("positions taken") ||
      body.includes("sign in");
    expect(acceptable).toBe(true);
    await expect(page.locator("body")).toBeVisible();
  });
});
