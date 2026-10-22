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

describe("textarea labels", () => {
  it("every <textarea> has an accessible name (aria-label, aria-labelledby, or an id a <label htmlFor> targets)", () => {
    const unlabelled: string[] = [];
    for (const file of tsxFiles(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<textarea\b[\s\S]*?\/>/g)) {
        const tag = match[0];
        if (/aria-label=|aria-labelledby=/.test(tag)) continue;
        const id = /\bid=["']([^"']+)["']/.exec(tag)?.[1];
        if (id && source.includes(`htmlFor="${id}"`)) continue;
        unlabelled.push(`${path.relative(process.cwd(), file)} ${id ?? "(no id)"}`);
      }
    }
    expect(unlabelled).toEqual([]);
  });
});
