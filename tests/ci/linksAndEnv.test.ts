import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("internal links and env example", () => {
  it("never links to a nonexistent app route", () => {
    const panel = readFileSync(path.join(root, "src/components/WeaknessLibraryPanel.tsx"), "utf8");
    expect(panel).not.toContain('href="/solo"');
    expect(panel).toContain('href="/" className="underline" data-testid="weakness-redrill"');
    expect(existsSync(path.join(root, "src/app"))).toBe(true);
  });

  it("documents model and fallback variables for every configured provider", () => {
    const env = readFileSync(path.join(root, ".env.example"), "utf8");
    const cfg = JSON.parse(readFileSync(path.join(root, "config/ai-providers.json"), "utf8"));
    const labels: string[] = (cfg.providers ?? []).map((p: { label: string }) => p.label);
    expect(labels.length).toBeGreaterThan(0);
    const missing = labels.flatMap((label) => {
      const upper = label.toUpperCase();
      return [
        `${upper}_MODEL=`,
        `${upper}_FALLBACK_MODELS=`,
      ].filter((key) => !env.includes(key));
    });
    expect(missing).toEqual([]);
  });

  it("does not claim a paid model call on the daily-topic route", () => {
    expect(readFileSync(path.join(root, "src/app/api/daily-topic/route.ts"), "utf8")).not.toContain("paid model call");
  });
});
