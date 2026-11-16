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

describe("async error announcements", () => {
  it("renders error paragraphs as live alerts", () => {
    const unannounced: string[] = [];
    for (const file of tsxFiles(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\{(\w*[Ee]rror) && <p\b[^>]*>/g)) {
        if (!/role="alert"/.test(match[0])) {
          unannounced.push(`${path.relative(process.cwd(), file)}: ${match[1]}`);
        }
      }
    }
    expect(unannounced).toEqual([]);
  });
});
