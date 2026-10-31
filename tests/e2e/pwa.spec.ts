import { test, expect } from "@playwright/test";

// The installable-app pieces push reminders depend on are served publicly
// (the proxy must not redirect them to sign-in).

test("manifest and service worker are served without a session", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(await manifest.json()).toMatchObject({ name: "Daily Debate", display: "standalone" });

  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(await sw.text()).toContain('addEventListener("push"');

  expect((await request.get("/icon-192.png")).status()).toBe(200);
});
