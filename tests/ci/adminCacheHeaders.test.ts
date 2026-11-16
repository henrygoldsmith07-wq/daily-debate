import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ADMIN_ROUTES = [
  "src/app/api/analytics/funnel/route.ts",
  "src/app/api/corpus/adjudicate/route.ts",
  "src/app/api/corpus/correct/route.ts",
  "src/app/api/corpus/export/route.ts",
  "src/app/api/corpus/import/route.ts",
  "src/app/api/corpus/reliability/route.ts",
  "src/app/api/corpus/system-comparison/route.ts",
];

describe("admin responses are not cacheable", () => {
  it("every admin route sets Cache-Control: no-store on its data response", () => {
    const missing = ADMIN_ROUTES.filter(
      (f) => !readFileSync(path.join(process.cwd(), f), "utf8").includes('"Cache-Control": "no-store"'),
    );
    expect(missing).toEqual([]);
  });
});
