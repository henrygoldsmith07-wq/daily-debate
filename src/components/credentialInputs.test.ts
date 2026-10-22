import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

describe("credential inputs", () => {
  it("email and password inputs disable auto-capitalisation and spellcheck", () => {
    const bad: string[] = [];
    for (const file of tsxFiles("src")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<input\b[\s\S]*?\/>/g)) {
        const tag = m[0];
        if (!/type="(email|password)"/.test(tag)) continue;
        if (!/autoCapitalize="none"/.test(tag) || !/spellCheck=\{false\}/.test(tag)) bad.push(file);
      }
    }
    expect(bad).toEqual([]);
  });
});
