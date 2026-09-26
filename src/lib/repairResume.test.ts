import { describe, expect, it } from "vitest";
import { latestUnfinishedRepair, type RepairAttemptLite } from "./repairResume";

function attempt(
  overrides: Partial<RepairAttemptLite> = {},
): RepairAttemptLite {
  return {
    debateId: "debate-1",
    targetKind: "evidence",
    score: 42,
    succeeded: false,
    createdAt: "2026-09-25T10:00:00.000Z",
    signals: ["name a source"],
    ...overrides,
  };
}

describe("latestUnfinishedRepair", () => {
  it("returns the newest unresolved repair episode", () => {
    const result = latestUnfinishedRepair([
      attempt({
        debateId: "older",
        targetKind: "logic",
        createdAt: "2026-09-24T10:00:00.000Z",
      }),
      attempt({
        debateId: "newer",
        targetKind: "rebuttal",
        score: 55,
        createdAt: "2026-09-25T11:00:00.000Z",
        signals: ["use a direct contrast"],
      }),
    ]);

    expect(result).toEqual({
      debateId: "newer",
      targetKind: "rebuttal",
      label: "Rebuttal",
      score: 55,
      attemptedAt: "2026-09-25T11:00:00.000Z",
      nextCue: "use a direct contrast",
    });
  });

  it("does not resurrect an episode once any retry succeeded", () => {
    const result = latestUnfinishedRepair([
      attempt({
        succeeded: true,
        score: 78,
        createdAt: "2026-09-25T10:05:00.000Z",
      }),
      attempt({
        succeeded: false,
        score: 35,
        createdAt: "2026-09-25T10:10:00.000Z",
      }),
    ]);

    expect(result).toBeNull();
  });

  it("skips completed episodes and falls back to an older unresolved one", () => {
    const result = latestUnfinishedRepair([
      attempt({
        debateId: "completed",
        targetKind: "logic",
        succeeded: true,
        createdAt: "2026-09-25T12:00:00.000Z",
      }),
      attempt({
        debateId: "unfinished",
        targetKind: "impact",
        score: 30,
        createdAt: "2026-09-25T09:00:00.000Z",
      }),
    ]);

    expect(result?.debateId).toBe("unfinished");
    expect(result?.label).toBe("Impact");
  });

  it("prefers a corrective cue over positive feedback", () => {
    const result = latestUnfinishedRepair([
      attempt({
        signals: ["substantive length", "clear sentence structure", "name a source, study, report, or data point"],
      }),
    ]);

    expect(result?.nextCue).toBe("name a source, study, report, or data point");
  });

  it("handles non-array signals without inventing a cue", () => {
    const result = latestUnfinishedRepair([
      attempt({ signals: { note: "not an array" } }),
    ]);

    expect(result?.nextCue).toBeNull();
  });
});
