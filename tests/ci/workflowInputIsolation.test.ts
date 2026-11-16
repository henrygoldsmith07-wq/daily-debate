import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS = path.join(process.cwd(), ".github", "workflows");

/**
 * GitHub substitutes `${{ ... }}` into `run:` scripts TEXTUALLY before bash
 * parses them. A free-form workflow_dispatch input interpolated there is a
 * command-injection primitive; inputs must be passed via `env:` instead.
 */
describe("workflow dispatch input isolation", () => {
  it("never interpolates dispatch inputs into shell run blocks", () => {
    const violations: string[] = [];
    for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
      const lines = readFileSync(path.join(WORKFLOWS, file), "utf8").split(/\r?\n/);
      let inRun = false;
      let runIndent = 0;
      for (const [i, line] of lines.entries()) {
        const indent = (line.match(/^\s*/) ?? [""])[0].length;
        if (/^\s*run:\s*[|>]/ .test(line)) {
          inRun = true;
          runIndent = indent;
          continue;
        }
        if (/^\s*run:.*\$\{\{.*inputs\./.test(line)) violations.push(`${file}:${i + 1} inline run`);
        if (inRun) {
          if (line.trim() && indent <= runIndent) inRun = false;
          else if (/\$\{\{[^}]*(github\.event\.inputs|inputs\.)/.test(line)) violations.push(`${file}:${i + 1}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
