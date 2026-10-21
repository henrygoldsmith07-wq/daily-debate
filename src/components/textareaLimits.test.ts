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

describe("textarea limits", () => {
  it("every <textarea> in src declares a maxLength", () => {
    const missing: string[] = [];
    for (const file of tsxFiles(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<textarea\b[\s\S]*?\/>/g)) {
        if (!/maxLength=/.test(match[0])) missing.push(path.relative(process.cwd(), file));
      }
    }
    expect(missing).toEqual([]);
  });
});
