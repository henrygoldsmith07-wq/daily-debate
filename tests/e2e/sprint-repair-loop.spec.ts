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

    // 6. Fix this now → repair exercise, WITHOUT expanding Full Analysis.
    await page.getByTestId("fix-this-now").click();
    await expect(page.getByTestId("repair-panel")).toBeVisible();
    await expect(page.getByTestId("full-analysis")).toBeHidden();

    // 7. Submit a deliberately weak first draft, then retry. Retry is a core
    // product behaviour: both attempts remain practice history, but analytics
    // must treat them as one repair episode and coaching must reflect the
    // latest submitted draft rather than getting stuck on attempt one.
    const repairBox = page.getByLabel("Improved argument move");
    await expect(repairBox).toBeVisible();
    await expect(repairBox).toBeFocused();

    await repairBox.fill("I disagree with this point.");
    await page.getByTestId("submit-repair").click();
    await expect(page.getByTestId("repair-feedback")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/not there yet/i).first()).toBeVisible();

    // A failed attempt is practice history, NOT a completed repair. Leaving
    // the page must not schedule a retest or strand the user without a retry.
    await page.goto("/");
    await expect(page.getByTestId("start-sprint")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Retest after repair", { exact: true })).toHaveCount(0);

    await page.goto(debateUrl);
    await expect(page.getByText(/Replay/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("repair-status")).toHaveCount(0);
    await expect(page.getByTestId("fix-this-now")).toBeVisible();
    await page.getByTestId("fix-this-now").click();
    await expect(page.getByTestId("repair-panel")).toBeVisible();

    // This two-sentence version clears every deterministic repair rubric:
    // source/evidence, contrast, reasoning bridge, weighing, structure and
    // short-sentence clarity.
    const retryBox = page.getByLabel("Improved argument move");
    await retryBox.fill(
      "However, NREL data supports solar cost declines because deployment scaled, making the evidence stronger than the reliability objection. Therefore storage trends matter more because they directly affect total system costs."
    );
    await page.getByTestId("submit-repair").click();
    await expect(page.getByTestId("repair-feedback")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/repair recorded/i).first()).toBeVisible();
    await expect(page.getByTestId("repair-status")).toBeVisible();

    // 8. Advanced analysis opens only on explicit request.
    await page.getByTestId("toggle-full-analysis").click();
    await expect(page.getByTestId("full-analysis")).toBeVisible();

    // 9. Back to Today — the repaired skill is now the explicit next-debate
    // retest, rather than being silently replaced by the generic weakest-skill
    // selector.
    await page.goto("/");
    await expect(page.getByTestId("start-sprint")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Retest after repair", { exact: true })).toBeVisible();

    // Progress and the drill coach must agree with Today — no parallel
    // selector is allowed to silently switch the target dimension.
    await page.goto("/progress");
    await expect(page.getByText("Retest after repair", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("repair-retest-card")).toBeVisible({ timeout: 20_000 });

    // 10. Replay uses the same hierarchy: repair already done → status shown,
    // no Fix-this-now CTA, and the graph stays collapsed until asked for.
    await page.goto(debateUrl);
    await expect(page.getByText(/Replay/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("repair-status")).toBeVisible();
    await expect(page.getByTestId("fix-this-now")).toBeHidden();
    await expect(page.getByTestId("full-analysis")).toBeHidden();
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
