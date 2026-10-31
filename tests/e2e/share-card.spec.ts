import { test, expect } from "@playwright/test";

// The share landing page and its Open Graph image render only validated
// codes from the URL — never free text.

test.describe("shared result", () => {
  test("landing page shows the squares and invites the visitor to today's motion", async ({ page }) => {
    await page.goto("/s?n=71&s=a&g=apd&r=1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Daily Debate #71");
    await expect(page.getByText("Argued Against")).toBeVisible();
    await expect(page.getByText("🟩🟨🟥")).toBeVisible();
    await expect(page.getByText("Weakness repaired ✓")).toBeVisible();
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/api\/share-image\?n=71&s=a&g=apd&r=1/);
    await page.getByRole("link", { name: /debate today's motion/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("malformed share links never echo their contents", async ({ page }) => {
    await page.goto("/s?n=71&s=a&g=%3Cb%3Ehi%3C%2Fb%3E");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Daily Debate");
    await expect(page.getByText("<b>hi</b>")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /debate today's motion/i })).toBeVisible();
  });

  test("the share image is a PNG", async ({ request }) => {
    const res = await request.get("/api/share-image?n=71&s=f&g=aad&r=0");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });
});
