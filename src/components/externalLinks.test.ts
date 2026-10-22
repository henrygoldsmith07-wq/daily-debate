import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith(".tsx") && !full.endsWith(".test.tsx") ? [full] : [];
  });
}

describe("external links", () => {
  it("every target=_blank link sets rel with noopener or noreferrer", () => {
    const bad: string[] = [];
    for (const file of tsxFiles(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
        if (!/rel="[^"]*(noopener|noreferrer)/.test(match[0])) bad.push(path.relative(process.cwd(), file));
      }
    }
    expect(bad).toEqual([]);
  });
});
