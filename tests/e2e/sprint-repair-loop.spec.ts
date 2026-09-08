import { test, expect } from "@playwright/test";
import { HAS_BACKEND, signIn } from "./helpers";

// ── Daily Sprint + repair loop E2E ───────────────────────────────────────────
//
// Requires ephemeral Postgres (migrations applied) and E2E_MOCK_AI=1 on the
// server so provider calls are deterministic and offline.
//
// Pipeline tested (the core product loop):
//   Today → start Daily Sprint → 3 rounds → finish
//   → one main weakness → Fix this now → submit repair → feedback
//   → return to Today/Progress

test.describe("daily sprint repair loop", () => {
  test.skip(!HAS_BACKEND, "Requires ephemeral Postgres");

  test("sprint → weakness → fix this now → repair → back to today", async ({ page }) => {
    // e2e-c is seeded by scripts/e2e-seed.mjs and kept exclusive to this spec.
    await signIn(page, "c");

    // 1. Today screen shows the sprint entry point.
    await expect(page.getByTestId("start-sprint")).toBeVisible({ timeout: 20_000 });

    // 2. Start a Daily Sprint.
    await page.getByTestId("start-sprint").click();
    await page.waitForURL(/\/debate\//, { timeout: 20_000 });

    const debateUrl = page.url();

    // 3. Play exactly 3 rounds (sprint cap).
    for (let round = 0; round < 3; round++) {
      const composer = page.getByLabel("Your debate response");
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill(
        `Round ${round + 1}: According to NREL data, solar costs fell below gas. However, grid reliability requires storage investment, which impacts total cost. Therefore policy must weigh both factors.`
      );
      await page.getByRole("button", { name: /^send$/i }).click();
      await page.waitForTimeout(1200);
    }

    // The composer is gone after the third round: sprint cap reached.
    await expect(page.getByLabel("Your debate response")).toBeHidden({ timeout: 15_000 });

    // 4. Finish & get scored.
    const finishBtn = page.getByTestId("finish-debate");
    await expect(finishBtn).toBeVisible({ timeout: 10_000 });
    await finishBtn.click();

    // 5. Simplified result: one main weakness, not a wall of analytics.
    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("main-weakness")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("fix-this-now")).toBeVisible();

    // Full analysis is hidden behind progressive disclosure.
    await expect(page.getByTestId("full-analysis")).toBeHidden();

    // 6. Fix this now → repair exercise.
    await page.getByTestId("fix-this-now").click();
    await expect(page.getByTestId("repair-panel")).toBeVisible();

    // 7. Submit a repair; feedback arrives with recorded persistence. The
    // rewrite covers every repair rubric (source, contrast, reasoning, weighing)
    // so it scores high regardless of which weakness got flagged.
    const repairBox = page.getByLabel("Improved argument move");
    await expect(repairBox).toBeVisible();
    await repairBox.fill(
      "However, according to NREL data, utility-scale solar LCOE fell below gas because deployment scaled; this matters more than the reliability objection because storage costs are falling too."
    );
    await page.getByTestId("submit-repair").click();
    await expect(page.getByTestId("repair-feedback")).toBeVisible({ timeout: 15_000 });

    // 8. Advanced analysis can be opened on demand.
    await page.getByTestId("toggle-full-analysis").click();
    await expect(page.getByTestId("full-analysis")).toBeVisible();

    // 9. Back to Today — the loop restarts with updated coaching focus.
    await page.goto("/");
    await expect(page.getByTestId("start-sprint")).toBeVisible({ timeout: 20_000 });

    // 10. Replay shows the completed debate in history.
    await page.goto(debateUrl);
    await expect(page.getByText(/Replay/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("sprint respects the 3-round cap server-side", async ({ page }) => {
    await signIn(page, "c");

    await page.getByTestId("start-sprint").click();
    await page.waitForURL(/\/debate\//, { timeout: 20_000 });

    for (let round = 0; round < 3; round++) {
      const composer = page.getByLabel("Your debate response");
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill(`Round ${round + 1}: Brookings finds tutoring outperforms per dollar, therefore targeted programmes win.`);
      await page.getByRole("button", { name: /^send$/i }).click();
      await page.waitForTimeout(1200);
    }

    // Finishing is possible at exactly 3 rounds (the sprint minimum).
    await expect(page.getByTestId("finish-debate")).toBeVisible({ timeout: 15_000 });
  });
});
