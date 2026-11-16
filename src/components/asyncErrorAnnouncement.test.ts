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

/** The nearest <p> opening tag before an error message must be a live alert. */
function assertAlertNear(source: string, needle: string, label: string, misses: string[]) {
  const at = source.indexOf(needle);
  if (at < 0) return; // message may live in another route/component
  const tagStart = source.lastIndexOf("<p", at);
  const tagEnd = source.indexOf(">", tagStart);
  if (tagStart < 0 || tagEnd < 0 || !/role="alert"/.test(source.slice(tagStart, tagEnd))) misses.push(label);
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

  it("announces error states rendered as ternaries or multi-line blocks", () => {
    const misses: string[] = [];
    const checks: Array<[string, string, string]> = [
      ["src/components/CoachToday.tsx", "{outcomesError}", "CoachToday outcomesError"],
      ["src/app/progress/page.tsx", "Drill history is temporarily unavailable", "progress drillRowsError"],
      ["src/app/progress/page.tsx", "Some coaching context is temporarily unavailable", "progress partial context"],
      ["src/components/PushOptIn.tsx", "didn&apos;t work", "PushOptIn error"],
    ];
    for (const [file, needle, label] of checks) {
      assertAlertNear(readFileSync(path.join(process.cwd(), file), "utf8"), needle, label, misses);
    }
    expect(misses).toEqual([]);
  });
});
