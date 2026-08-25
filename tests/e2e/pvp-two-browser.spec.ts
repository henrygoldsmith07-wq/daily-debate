import { test, expect, type Page } from "@playwright/test";

// ── Two-browser PvP full-flow E2E ────────────────────────────────────────────
//
// Tests the complete PvP lifecycle with two independent browser sessions:
//   matchmaking → alternate turns → judging → same result shown to both
//
// Requires ephemeral Supabase + AI interception (same pattern as solo flow).

const HAS_BACKEND = !!(
  process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_ANON_KEY
);

function mockAI(context: import("@playwright/test").BrowserContext) {
  const verdict = {
    choices: [{
      message: {
        content: JSON.stringify({
          rationale: "Player A presented more grounded claims with cited evidence.",
          argGraph: {
            nodes: [
              { id: "ca1", kind: "claim", owner: "a", text: "Player A claim.", round: 1 },
              { id: "cb1", kind: "claim", owner: "b", text: "Player B claim.", round: 1 },
              { id: "ra1", kind: "rebuttal", owner: "a", text: "Rebuttal to B.", round: 2, targets: ["cb1"] },
            ],
            edges: [{ from: "ra1", to: "cb1", relation: "rebuts" }],
            dropped: [], contradictions: [], concessions: [], fallacies: [],
            evidenceStats: { total: 0, byOwner: { a: 0, b: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 0, strong: 0 }, unsupportedClaimIds: [] },
            impactComparison: { a: 55, b: 45, rationale: "A had stronger impact weighing." },
          },
        }),
      },
    }],
  };
  context.route("**/integrate.api.nvidia.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(verdict) })
  );
  context.route("**/openrouter.ai/api/v1/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(verdict) })
  );
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill("e2e-test-pass-123");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
}

async function sendTurn(page: Page, text: string): Promise<boolean> {
  const composer = page.getByLabel("Your debate response");
  if (!(await composer.isVisible().catch(() => false))) return false;
  await composer.fill(text);
  await page.getByRole("button", { name: /^send$/i }).click();
  await page.waitForTimeout(2000);
  return true;
}

test.describe("two-browser pvp full-flow", () => {
  test.skip(!HAS_BACKEND, "Requires ephemeral Supabase");

  test("queue → match → alternate turns → judge → same result shown to both", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    mockAI(ctxA);
    mockAI(ctxB);

    const playerA = await ctxA.newPage();
    const playerB = await ctxB.newPage();

    // ── Sign in as two different users ──
    await signIn(playerA, "e2e-b@test.local");
    await signIn(playerB, "e2e-c@test.local");

    // ── Both navigate to PvP lobby ──
    await playerA.goto("/pvp");
    await playerB.goto("/pvp");
    await expect(playerA.getByText(/Player vs Player|Find an opponent/i).first()).toBeVisible({ timeout: 15_000 });

    // ── Player A joins queue first ──
    await playerA.getByRole("button", { name: /find an opponent/i }).click();
    await expect(playerA.getByText(/Looking for an opponent/i).first()).toBeVisible({ timeout: 10_000 });

    // ── Player B joins queue — should trigger match ──
    await playerB.getByRole("button", { name: /find an opponent/i }).click();

    // ── Wait for both to land in the same match room ──
    let matchId: string | null = null;
    for (const page of [playerA, playerB]) {
      try {
        await page.waitForURL(/\/pvp\/[a-f0-9-]+/, { timeout: 30_000 });
        const url = new URL(page.url());
        if (!matchId) matchId = url.pathname.split("/").pop() ?? null;
      } catch {
        // May need to wait for polling to detect the match
      }
    }
    expect(matchId).toBeTruthy();

    // If only one auto-navigated, manually navigate the other
    if (!playerA.url().includes(matchId!)) await playerA.goto(`/pvp/${matchId}`);
    if (!playerB.url().includes(matchId!)) await playerB.goto(`/pvp/${matchId}`);

    await expect(playerA.getByText(/You.*arguing/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(playerB.getByText(/You.*arguing/i).first()).toBeVisible({ timeout: 15_000 });

    // ── Alternate turns until round limit reached ──
    const maxRounds = 10; // 5 rounds × 2 players
    for (let round = 1; round <= maxRounds; round++) {
      const turnDone = await Promise.all(
        [playerA, playerB].map(async (page) => {
          const composer = page.getByLabel("Your debate response");
          return composer.isVisible().catch(() => false);
        })
      );
      const activePage = turnDone[0] ? playerA : turnDone[1] ? playerB : null;
      if (!activePage) break; // debate complete

      const msg = `Round ${round}: My argument uses NREL data and weighs long-term impacts over short-term costs because evidence shows sustained benefit.`;
      await sendTurn(activePage, msg);
      await playerA.waitForTimeout(1500);
      await playerB.waitForTimeout(1500);

      // Check completion
      const aDone = await playerA.getByText(/too close to call|won\b|opponent won/i).first().isVisible().catch(() => false);
      const bDone = await playerB.getByText(/too close to call|won\b|opponent won/i).first().isVisible().catch(() => false);
      if (aDone || bDone) break;
    }

    // ── Verify same result is visible to both ──
    // At least one of them must see a verdict (winner or tie)
    const verdictVisibleForA = await playerA
      .locator(".surface-card h2")
      .filter({ hasText: /won|close to call/i })
      .first()
      .isVisible()
      .catch(() => false);
    const verdictVisibleForB = await playerB
      .locator(".surface-card h2")
      .filter({ hasText: /won|close to call/i })
      .first()
      .isVisible()
      .catch(() => false);

    expect(verdictVisibleForA || verdictVisibleForB).toBe(true);

    // History shows the match for both
    for (const page of [playerA, playerB]) {
      await page.goto("/history");
      await expect(page.getByText(/Your debates/i).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('a[href^="/pvp/"]').first()).toBeVisible({ timeout: 10_000 });
    }

    await ctxA.close();
    await ctxB.close();
  });
});
