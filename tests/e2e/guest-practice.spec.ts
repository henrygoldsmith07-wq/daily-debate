import { test, expect } from "@playwright/test";

// The guest motion rotates by UTC day: `guestMotionForDay` indexes
// `GUEST_MOTIONS` by `daysSinceEpoch % length`, and `GuestArena` reads the
// BROWSER clock to pick it.
//
// This spec's writing is deliberately tied to the `phone-free-hour` motion:
// the round-2 concession ("accessibility and family care are real concerns")
// answers that motion's scripted opposing case ("...students who need a phone
// for accessibility, family care, or a safe trip home"), which is what drives
// `addressesOpponent` and the "you engaged the opponent" feedback.
//
// Left unpinned, that made the suite pass only on the one day in seven that
// motion is selected, and fail the other six -- reporting a copy mismatch that
// reads like a product regression rather than a scheduling accident. Pinning
// makes it deterministic; it does not relax any assertion.
//
// 2026-10-08 indexes to 0 (`phone-free-hour`). Re-derive after changing
// GUEST_MOTIONS:
//   Math.floor(Date.parse("2026-10-08T00:00:00Z") / 86_400_000) % 7 === 0
const PINNED_GUEST_DAY = "2026-10-08T12:00:00.000Z";

test.describe("guest practice honesty", () => {
  test("feedback reacts to the writing and the result leads into one repair", async ({ page }) => {
    await page.clock.setFixedTime(new Date(PINNED_GUEST_DAY));
    await page.goto("/");

    // Guards the pin itself: if GUEST_MOTIONS is reordered or resized, this
    // fails here with a legible reason instead of surfacing later as an
    // unrelated-looking feedback-copy mismatch.
    await expect(page.locator("#guest-motion")).toContainText(/phone-free hour/i);

    await expect(page.getByText("Guest mode", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /start a free practice/i }).click();

    const response = page.getByLabel("Your response");

    await response.fill(
      "Schools should use a phone-free hour because fewer notifications make it easier for students to focus during lessons.",
    );
    await page.getByRole("button", { name: /send response/i }).click();
    await expect(page.getByTestId("guest-round-feedback")).toContainText("connected your claim to a reason");
    await expect(page.getByTestId("guest-round-feedback")).toContainText("Evidence · not yet");
    await page.getByRole("button", { name: /take the next round/i }).click();

    await response.fill(
      "However, accessibility and family care are real concerns, but schools can allow exceptions because the rule only needs to protect normal lesson time.",
    );
    await page.getByRole("button", { name: /send response/i }).click();
    await expect(page.getByTestId("guest-round-feedback")).toContainText("opposing point");
    await page.getByRole("button", { name: /take the next round/i }).click();

    await response.fill(
      "On balance, focused learning matters more than convenience because students can still access phones outside the protected hour.",
    );
    await page.getByRole("button", { name: /send response/i }).click();
    await page.getByRole("button", { name: /see my result/i }).click();

    await expect(page.getByTestId("guest-result")).toBeVisible();
    await expect(page.getByText("Practice score")).toHaveCount(0);
    await expect(page.getByText(/\/ 100/)).toHaveCount(0);
    await expect(page.getByTestId("guest-main-weakness")).toContainText("Evidence");

    const repair = page.getByLabel("Your improved version");
    await repair.fill(
      "According to UNESCO research, reducing interruptions can improve learning because students spend more time focused on the lesson.",
    );
    await page.getByRole("button", { name: /check my repair/i }).click();

    await expect(page.getByTestId("guest-repair-feedback")).toContainText("Repair complete");

    // The loop is not finished by the repair alone. Signup is deliberately
    // withheld until the learner has been offered the retest.
    await expect(page.getByTestId("guest-retest-cta")).toBeVisible();
    await page.getByRole("button", { name: /retest this skill/i }).click();

    const retest = page.getByLabel("Your response");
    await retest.fill(
      "A UNESCO study of classroom phone bans reported fewer off-task transitions, which supports the claim during lessons.",
    );
    await page.getByRole("button", { name: /send it/i }).click();

    // One observed instance is reported as exactly that: never as mastery.
    await expect(page.getByTestId("guest-retest-outcome")).toBeVisible();
    await expect(page.getByTestId("guest-retest-outcome")).toContainText("one observed instance");
    await expect(page.getByRole("link", { name: /create a free account/i })).toBeVisible();
  });

  test("a trigger word alone cannot pass the repair", async ({ page }) => {
    await page.clock.setFixedTime(new Date(PINNED_GUEST_DAY));
    await page.goto("/");
    await page.getByRole("button", { name: /start a free practice/i }).click();

    const response = page.getByLabel("Your response");
    for (const text of [
      "Schools should use phone-free time because fewer notifications make lessons easier to follow.",
      "Schools should keep the rule because concentration matters for students during ordinary lesson time.",
      "Students should protect learning time because a short phone-free period still leaves the rest of the day available.",
    ]) {
      await response.fill(text);
      await page.getByRole("button", { name: /send response/i }).click();
      const next = page.getByRole("button", { name: /take the next round|see my result/i });
      await next.click();
    }

    const repair = page.getByLabel("Your improved version");
    await repair.fill("According to UNESCO.");
    await page.getByRole("button", { name: /check my repair/i }).click();

    await expect(page.getByTestId("guest-repair-feedback")).toContainText("Not there yet");
  });
});
