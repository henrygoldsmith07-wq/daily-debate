import { test, expect } from "@playwright/test";

// The political identifier reads stored positions; it makes no AI call. CI
// runs without Postgres credentials, so an unauthenticated visit is redirected
// to /login. When a backend is present the page must render its own root and a
// concrete state — never a crash page that happens to mention the title.

test.describe("political identifier", () => {
  test("auth-gates or renders a concrete state without crashing", async ({ page }) => {
    await page.goto("/political-identifier");
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
      await expect(page).toHaveURL(/\/login/);
      return;
    }

    const root = page.getByTestId("political-identifier");
    await expect(root).toBeVisible({ timeout: 15000 });
    // A real state is either the sample gate or the ledger — a generic error
    // page with the word "identifier" satisfies neither assertion.
    const gated = root.getByText(/Positions taken/i);
    const ledger = root.getByText(/The division ledger/i);
    await expect(gated.or(ledger).first()).toBeVisible();
  });
});
