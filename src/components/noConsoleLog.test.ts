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

describe("debug logging", () => {
  it("app source has no console.log calls", () => {
    const bad = sourceFiles(path.join(process.cwd(), "src")).filter((f) =>
      /\bconsole\.log\(/.test(readFileSync(f, "utf8")),
    );
    expect(bad.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});
