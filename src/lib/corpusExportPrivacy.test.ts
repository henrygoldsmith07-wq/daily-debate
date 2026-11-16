import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.resolve(__dirname, "../app/api/corpus/export/route.ts"), "utf8");

describe("corpus CSV privacy", () => {
  it("never writes a raw rater account id into the export", () => {
    expect(src).not.toContain('"rater_id"');
    const rowBlock = src.slice(src.indexOf("for (const r of orderedRatings)"));
    expect(rowBlock).not.toContain("r.rater_id,");
    expect(rowBlock).toContain("raterLabels.get");
  });
});
