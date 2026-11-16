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

describe("single-choice control semantics", () => {
  it("never mixes radiogroup with aria-pressed toggle buttons", () => {
    const mixed: string[] = [];
    for (const file of tsxFiles(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      // role="radiogroup" must own role="radio" children (ReaderPreferences).
      // Toggle buttons use plain role="group" + aria-pressed elsewhere.
      if (/role="radiogroup"/.test(source) && /aria-pressed=/.test(source)) {
        mixed.push(path.relative(process.cwd(), file));
      }
    }
    expect(mixed).toEqual([]);
  });
});
