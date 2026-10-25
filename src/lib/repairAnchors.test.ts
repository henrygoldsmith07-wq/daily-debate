import { describe, expect, it } from "vitest";
import { collapseRepairAnchors } from "./repairAnchors";

const row = (id: string, created_at: unknown, kind = "evidence" as const, debate = "d1") =>
  ({ id, debate_id: debate, target_kind: kind, created_at, topicId: "t1" }) as Parameters<typeof collapseRepairAnchors>[0][number];

describe("collapseRepairAnchors", () => {
  it("keeps the earliest success per debate+kind", () => {
    const out = collapseRepairAnchors([row("late", "2026-10-02T00:00:00Z"), row("early", "2026-10-01T00:00:00Z")]);
    expect(out).toHaveLength(1);
    expect(out[0].repairResultId).toBe("early");
  });
  it("drops rows with unparseable timestamps instead of stamping now", () => {
    expect(collapseRepairAnchors([row("bad", "nonsense"), row("null", null)])).toEqual([]);
  });
  it("normalises Date objects and sorts oldest first", () => {
    const out = collapseRepairAnchors([row("b", new Date("2026-10-05T00:00:00Z"), "evidence", "d2"), row("a", "2026-10-01T00:00:00Z")]);
    expect(out.map((a) => a.repairResultId)).toEqual(["a", "b"]);
    expect(out[1].attemptedAt).toBe("2026-10-05T00:00:00.000Z");
  });
});
