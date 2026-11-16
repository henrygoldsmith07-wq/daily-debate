import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.resolve(__dirname, "../app/api/corpus/import/route.ts"), "utf8");

describe("corpus import query count", () => {
  it("batch-loads relations instead of querying once per debate or match", () => {
    expect(src).toContain('.in("debate_id", pendingSolo.map((d) => d.id))');
    expect(src).toContain('.in("match_id", pendingPvp.map((m) => m.id))');
    expect(src).toContain('.in("id", profileIds)');
    expect(src).toContain('.in("id", topicIds)');
    // The per-row reads are gone; only the conflict-tolerant write remains.
    expect(src).not.toContain('.eq("debate_id", debate.id)');
    expect(src).not.toContain('.eq("match_id", match.id)');
    expect(src).toContain('insertIgnore({');
  });
});
