import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(test|spec)\.tsx?$/.test(name) && name !== "noFocusedTests.test.ts") out.push(p);
  }
  return out;
}

describe("focused tests", () => {
  it("no test or spec file commits .only, which would silently skip the rest", () => {
    const re = /\b(?:it|test|describe)\.only\s*\(/;
    const bad = ["src", "e2e", "tests"]
      .flatMap((d) => { try { return walk(d); } catch { return []; } })
      .filter((f) => re.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
