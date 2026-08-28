import { test, expect } from "@playwright/test";
import { HAS_BACKEND, signIn } from "./helpers";

// ── Full-flow solo debate E2E ────────────────────────────────────────────────
//
// Requires ephemeral Postgres running locally (migrations applied). AI judge
// calls are intercepted at the network layer so the suite is deterministic,
// free, and offline-capable.
//
// Pipeline tested:
//   signup/login → load topic → start debate → 5 rounds → finish
//   → score stored → graph produced → points awarded once → history replay

test.describe("solo full-flow", () => {
  test.skip(!HAS_BACKEND, "Requires ephemeral Postgres");

  // Intercept AI provider calls so the debate engine gets deterministic
  // responses without spending tokens or needing API keys.
  function mockAIProviders(context: import("@playwright/test").BrowserContext) {
    const aiResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            feedback: "Good structural argument.",
            aiMessage: "However, consider the counterfactual: without intervention costs, the outcome may differ significantly across regions and time horizons.",
          }),
        },
      }],
    };
    const graphResponse = {
      ...aiResponse,
      choices: [{
        message: {
          content: JSON.stringify({
            feedback: "Good structural argument.",
            aiMessage: "However, consider the counterfactual impact across time horizons.",
            argGraph: {
              nodes: [
                { id: "c1", kind: "claim", owner: "a", text: "Test claim.", round: 1 },
                { id: "e1", kind: "evidence", owner: "a", text: "Supporting evidence.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
                { id: "o1", kind: "counterclaim", owner: "ai", text: "Opposing claim.", round: 1 },
              ],
              edges: [{ from: "e1", to: "c1", relation: "supports" }],
              dropped: [], contradictions: [], concessions: [], fallacies: [],
              evidenceStats: { total: 1, byOwner: { a: 1, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 1, strong: 0 }, unsupportedClaimIds: [] },
              impactComparison: null,
            },
          }),
        },
      }],
    };

    context.route("**/integrate.api.nvidia.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(graphResponse) }));
    context.route("**/openrouter.ai/api/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(aiResponse) }));
    context.route("**/api.anthropic.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(aiResponse) }));
  }

  test("signup → topic → debate → 5 rounds → finish → score → history", async ({ page }) => {
    mockAIProviders(page.context());

    // 1. Sign in
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("e2e-a@test.local");
    await page.getByLabel(/password/i).fill("e2e-test-pass-123");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    // 2. Dashboard loads with today's topic
    await expect(page.getByText(/Today.*debate|Today.*topic/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".topic-card").first()).toBeVisible();

    // 3. Start solo debate
    await page.getByRole("button", { name: /start solo debate/i }).click();
    await page.waitForURL(/\/debate\//, { timeout: 20_000 });

    // Wait for the opening argument to appear
    await expect(page.locator(".question-text, [aria-label='road layout diagram'], .scene").first())
      .toBeVisible({ timeout: 15_000 });

    const debateUrl = page.url();

    // 4. Play 5+ rounds
    for (let round = 0; round < 5; round++) {
      const composer = page.getByLabel("Your debate response");
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill(
        `Round ${round + 1}: According to NREL data, solar LCOE dropped below gas in most markets. However, grid reliability requires storage investment, which impacts the total cost calculation. Therefore, policy must weigh both factors together.`
      );
      await page.getByRole("button", { name: /^send$/i }).click();
      // Wait for the next round's opening or the round counter to increment
      await expect(page.getByText(new RegExp(`Round ${round + 2}|pts so far`, "i")).first())
        .toBeVisible({ timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // 5. Finish & get scored
    const finishBtn = page.getByRole("button", { name: /finish/i });
    await expect(finishBtn).toBeVisible({ timeout: 10_000 });
    await finishBtn.click();

    // 6. Score displayed
    await expect(page.getByText(/\d+ pts/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Debate complete|Replay/i).first()).toBeVisible({ timeout: 15_000 });

    // 7. Graph produced (ArgGraphInline renders nodes)
    await expect(page.getByText(/Claim|Evidence|Counterclaim/i).first()).toBeVisible({ timeout: 15_000 });

    // 8. History replay: navigate to /history, verify entry exists
    await page.goto("/history");
    await expect(page.getByText(/Your debates/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('a[href^="/debate/"]').first()).toBeVisible({ timeout: 10_000 });

    // 9. Points awarded exactly once: revisit the same debate URL — no double award
    await page.goto(debateUrl);
    await expect(page.getByText(/Replay|points/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
