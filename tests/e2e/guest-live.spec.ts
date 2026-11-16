import { test, expect } from "@playwright/test";

// Live guest sprint: a signed-out visitor debates today's motion against the
// AI opponent. Needs the server's live offer (database + AI), which CI's e2e
// job provides with E2E_MOCK_AI=1 (deterministic scripted provider replies).

test.describe("live guest sprint", () => {
  test.skip(!process.env.E2E_DATABASE_URL || !process.env.E2E_MOCK_AI, "needs the e2e database and mock AI");

  const answers = [
    "Cities should do this because cleaner air protects children's health, and that benefit outweighs the inconvenience.",
    "However, the cost point misses who pays today: people breathing polluted air already bear the cost, so the policy shifts it fairly.",
    "On balance, health matters more than convenience because illness is permanent while travel habits can adapt within months.",
  ];

  test("opens on today's motion, streams the opponent, and finishes in the usual result", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("guest-mode-pill")).toHaveText(/live ai opponent/i);
    await expect(page.getByText(/go to a free-tier AI provider, which may log them/i)).toBeVisible();

    await page.getByRole("button", { name: /start a free practice/i }).click();
    const opponent = page.getByTestId("guest-opponent");
    await expect(opponent).toContainText("To open: your position rests on efficiency");

    const response = page.getByLabel("Your response");
    for (const [index, answer] of answers.entries()) {
      await expect(response).toBeEnabled();
      await response.fill(answer);
      await page.getByRole("button", { name: /send response/i }).click();
      await expect(page.getByTestId("guest-round-feedback")).toBeVisible();
      if (index < answers.length - 1) {
        await page.getByRole("button", { name: /take the next round/i }).click();
        await expect(opponent).toContainText("consider the counterfactual");
      }
    }
    await page.getByRole("button", { name: /see my result/i }).click();
    await expect(page.getByTestId("guest-result")).toBeVisible();
    await expect(page.getByTestId("guest-main-weakness")).toBeVisible();
  });

  test("falls back to the guided case when the live opponent is unavailable", async ({ page }) => {
    await page.route("**/api/guest/turn", (route) =>
      route.fulfill({ status: 503, json: { fallback: true, reason: "busy", error: "busy" } }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: /start a free practice/i }).click();
    await expect(page.getByTestId("guest-live-notice")).toContainText(/guided case on a sample motion/i);
    await expect(page.getByLabel("Your response")).toBeEnabled();
    await expect(page.getByTestId("guest-opponent")).not.toBeEmpty();
  });

  test("a failed reply mid-sprint can be carried on with a guided challenge", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/guest/turn", async (route) => {
      calls += 1;
      if (calls === 1) return route.continue();
      return route.fulfill({ status: 503, json: { fallback: true, reason: "provider_error", error: "The opponent couldn't answer." } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /start a free practice/i }).click();
    await expect(page.getByTestId("guest-opponent")).toContainText("To open");
    await page.getByLabel("Your response").fill(answers[0]);
    await page.getByRole("button", { name: /send response/i }).click();
    await page.getByRole("button", { name: /take the next round/i }).click();

    await expect(page.getByTestId("guest-opponent-error")).toBeVisible();
    await page.getByRole("button", { name: /carry on with a guided challenge/i }).click();
    await expect(page.getByTestId("guest-opponent")).toContainText("Someone who disagrees");
    await expect(page.getByLabel("Your response")).toBeEnabled();
  });
});
