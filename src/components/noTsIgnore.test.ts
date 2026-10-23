import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && name !== "noTsIgnore.test.ts") out.push(p);
  }
  return out;
}

describe("type-check suppressions", () => {
  it("no source file uses @ts-ignore or @ts-nocheck (use @ts-expect-error with a reason)", () => {
    const re = /@ts-(?:ignore|nocheck)\b/;
    const bad = walk("src").filter((f) => re.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  }, 30_000);
});
