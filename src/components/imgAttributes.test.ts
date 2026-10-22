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

describe("img attributes", () => {
  it("every <img> declares alt, width and height (accessibility, no layout shift)", () => {
    const bad: string[] = [];
    for (const file of tsxFiles(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<img\b[\s\S]*?\/>/g)) {
        const tag = match[0];
        if (!/\balt=/.test(tag) || !/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) {
          bad.push(path.relative(process.cwd(), file));
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
