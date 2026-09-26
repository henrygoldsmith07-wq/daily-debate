import { describe, expect, it } from "vitest";
import { emptyGraph } from "./argGraph";
import { assessArgumentGraph } from "./observableAssessment";
import { buildLedgerPointsFromRows } from "./skillLedgerAssembly";

function assessment() {
  return assessArgumentGraph(emptyGraph(), {
    sideA: "a",
    sideB: "ai",
    extractionSource: "deterministic",
    labelA: "You",
    labelB: "AI opponent",
  });
}

describe("buildLedgerPointsFromRows", () => {
  it("assembles multiple debates from one batched turn result and preserves topic identity", () => {
    const a = assessment();
    const points = buildLedgerPointsFromRows(
      [
        { id: "d1", completed_at: "2026-06-01T10:00:00Z", topic_id: "topic-a" },
        { id: "d2", completed_at: "2026-06-02T10:00:00Z", topic_id: "topic-b" },
      ],
      [
        { debate_id: "d2", round_number: 2, assessment: a, scores: { clarity: 8 } },
        { debate_id: "d1", round_number: 1, assessment: a, scores: { clarity: 6 } },
        { debate_id: "d2", round_number: 1, assessment: a, scores: { clarity: 4 } },
      ],
    );

    expect(points.map((point) => point.debateId)).toEqual(["d1", "d2"]);
    expect(points.map((point) => point.topicId)).toEqual(["topic-a", "topic-b"]);
    expect(points[1].metrics.clarity).toBe(0.6);
  });

  it("carries explicit repair-retest provenance into the ledger point", () => {
    const a = assessment();
    const points = buildLedgerPointsFromRows(
      [
        {
          id: "d1",
          completed_at: "2026-06-01T10:00:00Z",
          topic_id: "topic-b",
          coaching: {
            repairRetest: {
              repairResultId: "repair-result-1",
              repairDebateId: "repair-debate",
              targetKind: "evidence",
              attemptedAt: "2026-05-31T10:00:00Z",
            },
          },
        },
      ],
      [{ debate_id: "d1", round_number: 1, assessment: a, scores: { clarity: 7 } }],
    );

    expect(points[0].repairRetest).toEqual({
      repairResultId: "repair-result-1",
      repairDebateId: "repair-debate",
      targetKind: "evidence",
      attemptedAt: "2026-05-31T10:00:00Z",
    });
  });

  it("preserves legacy repair assignments that predate repairResultId", () => {
    const a = assessment();
    const points = buildLedgerPointsFromRows(
      [
        {
          id: "d1",
          completed_at: "2026-06-01T10:00:00Z",
          topic_id: "topic-b",
          coaching: {
            repairRetest: {
              repairDebateId: "repair-debate",
              targetKind: "rebuttal",
              attemptedAt: "2026-05-31T10:00:00Z",
            },
          },
        },
      ],
      [{ debate_id: "d1", round_number: 1, assessment: a, scores: { clarity: 7 } }],
    );

    expect(points[0].repairRetest).toMatchObject({
      repairResultId: null,
      repairDebateId: "repair-debate",
      targetKind: "rebuttal",
    });
  });

  it("skips debates that have no stored observable assessment", () => {
    const points = buildLedgerPointsFromRows(
      [{ id: "d1", completed_at: "2026-06-01T10:00:00Z", topic_id: "topic-a" }],
      [{ debate_id: "d1", round_number: 1, assessment: null, scores: { clarity: 7 } }],
    );
    expect(points).toEqual([]);
  });
});
