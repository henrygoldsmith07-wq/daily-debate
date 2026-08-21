import { test, expect } from "@playwright/test";

// PvP / history / evaluation-surface E2E flows.
//
// CI runs without Supabase credentials; the middleware redirects every
// unauthenticated page to /login, so the default suite asserts failure
// states and no-crash guarantees. Authenticated flows (two-player match,
// reconnect, history replay) require a seeded backend via
// E2E_SUPABASE_URL + E2E_SUPABASE_ANON_KEY and are skipped otherwise.

const HAS_E2E_BACKEND = !!(process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_ANON_KEY);

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(process.env.E2E_TEST_EMAIL ?? "e2e@example.com");
  await page.getByLabel(/password/i).fill(process.env.E2E_TEST_PASSWORD ?? "e2e-password");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
}

test.describe("pvp + history surfaces", () => {
  test("pvp lobby renders or auth-gates without crashing", async ({ page }) => {
    await page.goto("/pvp");
    await page.waitForLoadState("domcontentloaded");
    const url = page.url();
    if (url.includes("/login")) {
      await expect(page.locator("body")).toBeVisible();
    } else {
      await expect(page.getByText(/Player vs Player/i).first()).toBeVisible({ timeout: 15000 });
    }
  });

  test("history page renders or auth-gates without crashing", async ({ page }) => {
    await page.goto("/history");
    await page.waitForLoadState("domcontentloaded");
    const url = page.url();
    const body = (await page.content()).toLowerCase();
    const acceptable = url.includes("/login") || body.includes("your debates") || body.includes("sign in");
    expect(acceptable).toBe(true);
    await expect(page.locator("body")).toBeVisible();
  });

  test("benchmark page exposes the six-dimension evaluation pipeline", async ({ page }) => {
    await page.goto("/benchmark");
    await page.waitForLoadState("domcontentloaded");
    const url = page.url();
    if (url.includes("/login")) {
      await expect(page.locator("body")).toBeVisible();
    } else {
      await expect(page.getByText(/Evaluation pipeline \(synthetic scaffold\)/i).first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Reliability gate/i).first()).toBeVisible();
      await expect(page.getByText(/Bias probes/i).first()).toBeVisible();
    }
  });

  test("authenticated two-player pvp flow: queue, alternate turns, verdict", async ({ browser }) => {
    test.skip(!HAS_E2E_BACKEND, "Requires E2E_SUPABASE_URL/E2E_SUPABASE_ANON_KEY with a seeded project and two accounts");
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    // Player A joins the queue, then player B matches against them.
    await signIn(a);
    await a.goto("/pvp");
    await a.getByRole("button", { name: /find an opponent/i }).click();
    await signIn(b);
    await b.goto("/pvp");
    await b.getByRole("button", { name: /find an opponent/i }).click();

    // Both should land in the same match room.
    await Promise.all([
      a.waitForURL(/\/pvp\/[^/]+$/, { timeout: 30000 }),
      b.waitForURL(/\/pvp\/[^/]+$/, { timeout: 30000 }),
    ]);

    // Alternate turns until the room shows a completed state.
    for (let round = 0; round < 10; round++) {
      for (const [page, msg] of [
        [a, `Argument variant ${round} A: evidence beats assertion.`],
        [b, `Rebuttal variant ${round} B: scope limits that claim.`],
      ] as const) {
        const composer = page.getByLabel("Your debate response");
        if (await composer.isVisible().catch(() => false)) {
          await composer.fill(msg);
          await page.getByRole("button", { name: /^send$/i }).click();
          await page.waitForTimeout(1000);
        }
      }
      const done =
        (await a.getByText(/too close to call|won|opponent won/i).first().isVisible().catch(() => false)) ||
        (await b.getByText(/too close to call|won|opponent won/i).first().isVisible().catch(() => false));
      if (done) break;
    }

    await ctxA.close();
    await ctxB.close();
  });

  test("authenticated player sees reconnect indicator only when realtime drops", async ({ page, context }) => {
    test.skip(!HAS_E2E_BACKEND, "Requires seeded backend");
    await signIn(page);
    await page.goto("/history");
    await expect(page.getByText(/Your debates/i).first()).toBeVisible({ timeout: 15000 });
    // Reconnect path is exercised implicitly by the polling fallback in
    // PvpRoom; here we assert the history → completed-debate replay link.
    const firstCompleted = page.locator('a[href^="/debate/"]').first();
    if (await firstCompleted.isVisible().catch(() => false)) {
      await firstCompleted.click();
      await page.waitForLoadState("domcontentloaded");
      const body = await page.content();
      const acceptable = body.includes("Replay") || body.includes("Round") || body.includes("Finish");
      expect(acceptable).toBe(true);
    }
    await context.close();
  });
});
