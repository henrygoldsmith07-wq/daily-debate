import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(path.resolve(__dirname, "../../daily-debate-site/index.html"), "utf8");

describe("static landing page", () => {
  it("does not advertise flag-gated PvP as a shipped feature", () => {
    expect(html).not.toContain("Player vs Player");
    expect(html).not.toContain("solo vs AI or PvP");
  });

  it("has an h2 before the feature cards and a focusable skip target", () => {
    const features = html.indexOf('id="features"');
    const firstCard = html.indexOf("<h3", features);
    const heading = html.indexOf("<h2", features);
    expect(heading).toBeGreaterThan(features);
    expect(heading).toBeLessThan(firstCard);
    expect(html).toContain('<section class="hero" id="main" tabindex="-1">');
  });
});
