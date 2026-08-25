// Shared E2E helpers. Only used when HAS_E2E_BACKEND is truthy — the specs
// guard with `test.skip(!HAS_E2E_BACKEND, ...)` so CI without credentials
// never reaches these code paths.

import type { Page } from "@playwright/test";

export const HAS_BACKEND = !!(
  process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_ANON_KEY
);

export function testEmail(suffix?: string): string {
  return suffix ? `e2e-${suffix}@test.local` : (process.env.E2E_TEST_EMAIL ?? "e2e-a@test.local");
}

export function testPassword(): string {
  return process.env.E2E_TEST_PASSWORD ?? "e2e-test-pass-123";
}

/** Sign in via the login form. Resolves after redirect away from /login. */
export async function signIn(page: Page, emailSuffix?: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(testEmail(emailSuffix));
  await page.getByLabel(/password/i).fill(testPassword());
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
}

/**
 * Submit a debate turn and wait for the response.
 * Returns true if the turn was accepted; false if the composer wasn't visible.
 */
export async function submitTurn(page: Page, text: string): Promise<boolean> {
  const composer = page.getByLabel("Your debate response");
  if (!(await composer.isVisible().catch(() => false))) return false;
  await composer.fill(text);
  await page.getByRole("button", { name: /^send$/i }).click();
  // Wait for the send button to re-enable or the round counter to change
  await page.waitForTimeout(2000);
  return true;
}

/** Check whether the room shows a completed state. */
export async function isDebateComplete(page: Page): Promise<boolean> {
  return (
    (await page
      .getByText(/too close to call|won\b|opponent won|replay|finish.*scored/i)
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await page.getByText(/Round limit reached/i).first().isVisible().catch(() => false))
  );
}
