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

describe("text inputs state their autofill behaviour", () => {
  it("every typed text/number/password input sets autoComplete", () => {
    const missing: string[] = [];
    for (const file of tsxFiles("src")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<input\b[\s\S]*?\/>/g)) {
        const tag = m[0];
        if (/type="(hidden|range|radio|checkbox|submit|button)"/.test(tag)) continue;
        if (!/autoComplete=/.test(tag)) missing.push(file);
      }
    }
    expect(missing).toEqual([]);
  });
});
