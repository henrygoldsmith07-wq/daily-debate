import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full) ? [full] : [];
  });
}

describe("raw HTML injection", () => {
  it("dangerouslySetInnerHTML is used only in the root layout", () => {
    const used = sourceFiles(path.join(process.cwd(), "src"))
      .filter((f) => readFileSync(f, "utf8").includes("dangerouslySetInnerHTML"))
      .map((f) => path.relative(process.cwd(), f).split(path.sep).join("/"));
    expect(used).toEqual(["src/app/layout.tsx"]);
  });
});
