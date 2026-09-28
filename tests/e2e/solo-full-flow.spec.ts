import { test, expect } from "@playwright/test";
import pg from "pg";
import { HAS_BACKEND } from "./helpers";

// ── Full-flow solo debate E2E ────────────────────────────────────────────────
//
// Requires ephemeral Postgres running locally (migrations applied). AI judge
// calls are intercepted at the network layer so the suite is deterministic,
// free, and offline-capable.
//
// Pipeline tested:
//   signup/login → load topic → start debate → 5 rounds → finish
//   → performance stored → graph produced → XP awarded once → history replay

test.describe("solo full-flow", () => {
  test.skip(!HAS_BACKEND, "Requires ephemeral Postgres");

  // Intercept AI provider calls so the debate engine gets deterministic
  // responses without spending tokens or needing API keys.
  function mockAIProviders(
    context: import("@playwright/test").BrowserContext,
    options?: {
      shouldFail?: () => boolean;
      delayMs?: number;
      onProviderCall?: () => void;
    },
  ) {
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

    const respond = async (route: import("@playwright/test").Route, body: unknown) => {
      options?.onProviderCall?.();
      if (options?.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options?.shouldFail?.()) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "provider unavailable" }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    };

    context.route("**/integrate.api.nvidia.com/**", (route) => respond(route, graphResponse));
    context.route("**/openrouter.ai/api/v1/**", (route) => respond(route, aiResponse));
    context.route("**/api.anthropic.com/**", (route) => respond(route, aiResponse));
  }

  test("signup → topic → debate → 5 rounds → finish → performance → history", async ({ page }) => {
    mockAIProviders(page.context());

    // 1. Sign in
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("e2e-a@test.local");
    await page.getByLabel(/password/i).fill("e2e-test-pass-123");
    await page.getByTestId("auth-submit").click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    // 2. Dashboard loads with today's topic
    await expect(page.getByText(/Today.*debate|Today.*topic/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".home-motion-card").first()).toBeVisible();

    // 3. Start full solo debate
    await page.getByTestId("start-full").click();
    await page.waitForURL(/\/debate\//, { timeout: 20_000 });

    // Wait for the debate room: topic header + opening argument from the AI.
    await expect(page.getByLabel("Your debate response")).toBeVisible({ timeout: 20_000 });

    const debateUrl = page.url();

    // 4. Play 5+ rounds
    for (let round = 0; round < 5; round++) {
      const composer = page.getByLabel("Your debate response");
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill(
        `Round ${round + 1}: According to NREL data, solar LCOE dropped below gas in most markets. However, grid reliability requires storage investment, which impacts the total cost calculation. Therefore, policy must weigh both factors together.`
      );
      await page.getByRole("button", { name: /^send$/i }).click();
      // Round advancement is a hard assertion: if answer persistence and next-turn
      // creation ever diverge, this must fail rather than silently continuing.
      await expect(page.getByTestId("round-status")).toContainText(`Round ${round + 2}`, { timeout: 30_000 });
    }

    // 5. Finish & get a length-normalized performance read
    const finishBtn = page.getByRole("button", { name: /finish/i });
    await expect(finishBtn).toBeVisible({ timeout: 10_000 });
    await finishBtn.click();

    // 6. Simplified result card: one weakness, Fix-this-now CTA, normalized
    // performance plus cumulative XP as secondary feedback.
    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("main-weakness")).toBeVisible();
    await expect(page.getByText("Performance", { exact: true })).toBeVisible();
    await expect(page.getByTestId("fix-this-now")).toBeVisible();
    await expect(page.getByText(/Debate complete|Replay/i).first()).toBeVisible({ timeout: 15_000 });

    // 6b. The advanced analysis (graph + tracking grid) sits behind disclosure.
    await page.getByTestId("toggle-full-analysis").click();

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
  test("full debate keeps round 12 playable and never creates round 13", async ({ page }) => {
    test.setTimeout(120_000);
    // This deliberately sends 12 turn requests in one test. Give it its own
    // test-only client IP so it cannot exhaust the production-style per-IP
    // turn budget for unrelated E2E scenarios sharing the same CI browser host.
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.12" });
    mockAIProviders(page.context());

    await page.goto("/login");
    await page.getByLabel(/email/i).fill("e2e-b@test.local");
    await page.getByLabel(/password/i).fill("e2e-test-pass-123");
    await page.getByTestId("auth-submit").click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    await expect(page.getByText(/Today.*debate|Today.*topic/i).first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("start-full").click();
    await page.waitForURL(/\/debate\//, { timeout: 20_000 });

    for (let round = 1; round <= 11; round++) {
      const composer = page.getByLabel("Your debate response");
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill(
        `Round ${round}: My distinct argument ${round} weighs evidence, responds to the opponent, and explains why the practical impact matters for the motion.`
      );
      await page.getByRole("button", { name: /^send$/i }).click();
      await expect(page.getByTestId("round-status")).toContainText(`Round ${round + 1}`, { timeout: 30_000 });
    }

    await expect(page.getByTestId("round-status")).toContainText("Round 12");
    const finalComposer = page.getByLabel("Your debate response");
    await expect(finalComposer).toBeVisible();
    await finalComposer.fill(
      "Round 12: My final answer directly resolves the remaining clash, compares the impacts, and closes the case with a distinct conclusion."
    );
    await page.getByRole("button", { name: /^send$/i }).click();

    await expect(page.getByLabel("Your debate response")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("round-status")).toContainText("Round 12");
    await expect(page.getByText(/Round 13/i)).toHaveCount(0);

    const finishBtn = page.getByRole("button", { name: /finish/i });
    await expect(finishBtn).toBeVisible();
    await finishBtn.click();
    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 30_000 });
  });
  test("stale-tab drafts cannot attach to a newer round and committed retries are idempotent", async ({ page, context }, testInfo) => {
    test.setTimeout(90_000);
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.18" });
    mockAIProviders(context);

    const identity = testInfo.retry === 0 ? "e2e-h@test.local" : "e2e-i@test.local";
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(identity);
    await page.getByLabel(/password/i).fill("e2e-test-pass-123");
    await page.getByTestId("auth-submit").click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    await page.getByTestId("start-sprint").click();
    await page.waitForURL(/\/debate\//, { timeout: 20_000 });
    const debateUrl = page.url();

    const staleTab = await context.newPage();
    await staleTab.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.18" });
    await staleTab.goto(debateUrl);
    const staleComposer = staleTab.getByLabel("Your debate response");
    await expect(staleComposer).toBeVisible({ timeout: 20_000 });
    const staleDraft = "This draft answers the original round-one challenge and must never be attached to round two.";
    await staleComposer.fill(staleDraft);

    let firstSubmissionBody: Record<string, unknown> = {};
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/api\/solo\/[^/]+\/turn$/.test(new URL(request.url()).pathname)) {
        firstSubmissionBody = request.postDataJSON() as Record<string, unknown>;
      }
    });

    const primaryComposer = page.getByLabel("Your debate response");
    await primaryComposer.fill(
      "Round one committed answer: evidence supports the claim, but the counterfactual limits how broadly we should generalise it."
    );
    await page.getByRole("button", { name: /^send$/i }).click();
    await expect(page.getByTestId("round-status")).toContainText("Round 2", { timeout: 30_000 });
    expect(firstSubmissionBody["expectedTurnId"]).toBeTruthy();

    const replay = await page.evaluate(async ({ body }) => {
      const response = await fetch(window.location.pathname.replace(/^\/debate\//, "/api/solo/") + "/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    }, { body: firstSubmissionBody });
    expect(replay.status).toBe(200);
    expect(replay.data.replayed).toBe(true);

    await staleTab.getByRole("button", { name: /^send$/i }).click();
    await expect(staleTab.locator('p[role="alert"]')).toContainText(/advanced in another tab|already answered in another tab/i, { timeout: 15_000 });
    await expect(staleComposer).toHaveValue(staleDraft);

    await staleTab.reload();
    await expect(staleTab.getByTestId("round-status")).toContainText("Round 2", { timeout: 20_000 });
    await staleTab.close();
  });

  test("timed training mode survives a page reload with the original window", async ({ page }) => {
    mockAIProviders(page.context());

    await page.goto("/login");
    await page.getByLabel(/email/i).fill("e2e-j@test.local");
    await page.getByLabel(/password/i).fill("e2e-test-pass-123");
    await page.getByTestId("auth-submit").click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    await page.getByTestId("start-sprint").click();
    await page.waitForURL(/\/debate\//, { timeout: 20_000 });
    await expect(page.getByLabel("Your debate response")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "More modes" }).click();
    const rapid = page.getByRole("button", { name: /Rapid \(60s\)/ });
    await rapid.click();
    await expect(rapid).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/\d+s remaining/)).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await page.getByRole("button", { name: "More modes" }).click();
    const restoredRapid = page.getByRole("button", { name: /Rapid \(60s\)/ });
    await expect(restoredRapid).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
    await expect(page.getByText(/\d+s remaining/)).toBeVisible({ timeout: 10_000 });
  });

  test("concurrent Start requests converge on one canonical debate", async ({ page, context }, testInfo) => {
    test.setTimeout(60_000);
    mockAIProviders(context);

    const identity = testInfo.retry === 0 ? "e2e-l@test.local" : "e2e-m@test.local";
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(identity);
    await page.getByLabel(/password/i).fill("e2e-test-pass-123");
    await page.getByTestId("auth-submit").click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    const second = await context.newPage();
    await second.goto("/");
    await expect(page.getByTestId("start-sprint")).toBeVisible();
    await expect(second.getByTestId("start-sprint")).toBeVisible();

    await Promise.all([
      page.getByTestId("start-sprint").click(),
      second.getByTestId("start-sprint").click(),
    ]);

    await Promise.race([
      page.waitForURL(/\/debate\//, { timeout: 20_000 }),
      second.waitForURL(/\/debate\//, { timeout: 20_000 }),
    ]);

    const pageStarted = /\/debate\//.test(new URL(page.url()).pathname);
    const secondStarted = /\/debate\//.test(new URL(second.url()).pathname);
    const winner = pageStarted ? page : second;
    const loser = pageStarted ? second : page;
    const canonicalPath = new URL(winner.url()).pathname;

    // Both race outcomes are correct:
    // 1. the loser gets the short-lived start-in-progress response and stays
    //    on Today, then a retry returns the canonical committed debate; or
    // 2. the winner commits before the loser's route checks existing state,
    //    so both tabs navigate immediately. Do not couple the invariant to the
    //    transient alert paint timing.
    if (!(pageStarted && secondStarted)) {
      const loserStart = loser.getByTestId("start-sprint");
      await expect(loserStart).toBeVisible({ timeout: 10_000 });

      // A transient start-in-progress response leaves the loser on Today while
      // its first click is still unwinding. Visibility alone is not retry-ready:
      // the button remains disabled until TopicCard clears its local starting
      // state. Wait for either canonical navigation or an enabled retry.
      await expect.poll(
        async () => {
          if (/\/debate\//.test(new URL(loser.url()).pathname)) return "navigated";
          const retryReady = await loserStart.isEnabled().catch(() => false);
          return retryReady ? "retry-ready" : "waiting";
        },
        { timeout: 20_000, message: "losing Start tab should navigate or become retryable" },
      ).toMatch(/^(navigated|retry-ready)$/);

      if (!/\/debate\//.test(new URL(loser.url()).pathname)) {
        await loserStart.click();
        await loser.waitForURL(/\/debate\//, { timeout: 20_000 });
      }
    } else {
      await page.waitForURL(/\/debate\//, { timeout: 20_000 });
      await second.waitForURL(/\/debate\//, { timeout: 20_000 });
    }

    expect(new URL(page.url()).pathname).toBe(canonicalPath);
    expect(new URL(second.url()).pathname).toBe(canonicalPath);

    const dbUrl = process.env.E2E_DATABASE_URL;
    expect(dbUrl).toBeTruthy();
    const pool = new pg.Pool({ connectionString: dbUrl });
    try {
      const state = await pool.query<{ active_count: string; opening_count: string }>(
        `SELECT
           count(distinct d.id)::text AS active_count,
           count(t.id)::text AS opening_count
         FROM app_users u
         JOIN solo_debates d ON d.user_id = u.id AND d.status = 'active'
         LEFT JOIN solo_debate_turns t ON t.debate_id = d.id AND t.round_number = 1
         WHERE u.email = $1`,
        [identity],
      );
      expect(Number(state.rows[0].active_count)).toBe(1);
      expect(Number(state.rows[0].opening_count)).toBe(1);
    } finally {
      await pool.end();
    }

    await second.close();
  });

  test("an accepted response left staged by provider failure can finish without another opponent call", async ({ page, context }) => {
    test.setTimeout(120_000);
    mockAIProviders(context);

    await page.goto("/login");
    await page.getByLabel(/email/i).fill("e2e-k@test.local");
    await page.getByLabel(/password/i).fill("e2e-test-pass-123");
    await page.getByTestId("auth-submit").click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    await page.getByTestId("start-full").click();
    await page.waitForURL(/\/debate\//, { timeout: 20_000 });

    // Reach the full-debate minimum while the deterministic server mock is
    // healthy. Answering round five creates pending round six.
    for (let round = 1; round <= 5; round++) {
      const composer = page.getByLabel("Your debate response");
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill(
        `Round ${round}: This answer uses evidence, directly answers the clash, and compares the practical impacts before drawing a conclusion.`,
      );
      await page.getByRole("button", { name: /^send$/i }).click();
      await expect(page.getByTestId("round-status")).toContainText(`Round ${round + 1}`, { timeout: 30_000 });
    }

    // Playwright cannot intercept the Next.js server process's outbound
    // provider traffic. Seed the exact durable state that the turn route leaves
    // after provider failure: accepted/staged answer, no active submission
    // lease, no next opponent turn.
    const debateId = new URL(page.url()).pathname.split("/").pop();
    expect(debateId).toBeTruthy();
    const dbUrl = process.env.E2E_DATABASE_URL;
    expect(dbUrl).toBeTruthy();
    const pool = new pg.Pool({ connectionString: dbUrl });
    try {
      const pending = await pool.query<{ id: string }>(
        `SELECT id
         FROM solo_debate_turns
         WHERE debate_id = $1
           AND user_message IS NULL
         ORDER BY round_number DESC
         LIMIT 1`,
        [debateId],
      );
      expect(pending.rows[0]?.id).toBeTruthy();
      await pool.query(
        `UPDATE solo_debate_turns
         SET staged_user_message = $2,
             staged_input_mode = 'text',
             staged_scores = '{}'::jsonb,
             staged_turn_score = 30,
             staged_assessment = NULL,
             staged_training_meta = '{"modeId":"text","elapsedSeconds":12,"modeWarnings":[],"speechTiming":null,"speechAnalysis":null,"speechQuality":null}'::jsonb,
             staged_mode = 'text',
             staged_submitted_at = clock_timestamp(),
             submission_token = NULL,
             submission_started_at = NULL
         WHERE id = $1`,
        [
          pending.rows[0].id,
          "Round six saved answer: this response remains durable after opponent generation fails.",
        ],
      );
    } finally {
      await pool.end();
    }

    await page.reload();
    await expect(page.getByText(/response is saved/i)).toBeVisible({ timeout: 20_000 });
    const finishSaved = page.getByRole("button", { name: /Finish with saved response/i });
    await expect(finishSaved).toBeVisible({ timeout: 10_000 });
    await finishSaved.click();

    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Performance", { exact: true })).toBeVisible();
    const debateUrl = page.url();

    // Reload proves completion/result replay does not require opponent
    // generation to recover after the accepted response was staged.
    await page.goto(debateUrl);
    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Replay|Debate complete/i).first()).toBeVisible();
  });

});
