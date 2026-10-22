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

describe("button types", () => {
  it("every <button> declares an explicit type so it never submits a form by accident", () => {
    const bad: string[] = [];
    for (const file of tsxFiles(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<button\b[\s\S]*?(?<!=)>/g)) {
        if (!/\btype=/.test(match[0]) && !match[0].includes("{...")) {
          bad.push(path.relative(process.cwd(), file));
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
