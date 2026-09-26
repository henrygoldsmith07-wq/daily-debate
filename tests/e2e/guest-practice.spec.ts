import { test, expect } from "@playwright/test";

test.describe("guest practice honesty", () => {
  test("feedback reacts to the writing and the result leads into one repair", async ({ page }) => {
    await page.goto("/");

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
    await expect(page.getByRole("link", { name: /create account and retest this skill/i })).toBeVisible();
  });

  test("a trigger word alone cannot pass the repair", async ({ page }) => {
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
