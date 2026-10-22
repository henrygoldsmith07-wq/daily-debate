import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(test|spec)\.tsx?$/.test(name) && name !== "noSkippedTests.test.ts") out.push(p);
  }
  return out;
}

describe("skipped tests", () => {
  it("no test or spec file commits an unconditional .skip, which hides failures", () => {
    const re = /\b(?:it|test|describe)\.skip\s*\(\s*["'`]/; // conditional test.skip(cond, reason) is allowed
    const bad = ["src", "e2e", "tests"]
      .flatMap((d) => { try { return walk(d); } catch { return []; } })
      .filter((f) => re.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  }, 30_000);
});
