import { describe, expect, it } from "vitest";
import { summarizeFeedbackMissed, type FunnelEventRow } from "@/lib/productFunnel";

const row = (name: string, debate_id: string | null, user_id = "u1"): FunnelEventRow => ({
  user_id, name, format: null, reason: null, created_at: "2026-10-28T10:00:00Z", debate_id,
});

describe("summarizeFeedbackMissed", () => {
  it("withholds the rate below the sample gate", () => {
    const s = summarizeFeedbackMissed([row("debate_completed", "d1"), row("weakness_feedback_missed", "d1")]);
    expect(s.flagRate).toBeNull();
    expect(s.flaggedDebates).toBe(1);
    expect(s.note).toMatch(/unvalidated/);
  });
  it("counts distinct flagged debates and reports a rate at the gate", () => {
    const rows = ["a", "b", "c", "d"].map((d) => row("debate_completed", d));
    rows.push(row("debate_completed", "e"), row("weakness_feedback_missed", "a"), row("weakness_feedback_missed", "a"));
    const s = summarizeFeedbackMissed(rows);
    expect(s.flaggedDebates).toBe(1);
    expect(s.flagRate).toBe(0.2);
  });
});
