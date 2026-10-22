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

describe("debugger statements", () => {
  it("app source never ships a debugger statement", () => {
    const offenders = sourceFiles(path.join(process.cwd(), "src"))
      .filter((f) => /^\s*debugger\s*;?\s*$/m.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(process.cwd(), f).split(path.sep).join("/"));
    expect(offenders).toEqual([]);
  });
});
