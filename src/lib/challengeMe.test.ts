import { describe, expect, it } from "vitest";
import {
  assignChallengeSide,
  normaliseSoloPerformance,
  type SideHistoryItem,
} from "./challengeMe";

function history(specs: Array<[side: "for" | "against", score?: number | null]>): SideHistoryItem[] {
  return specs.map(([side, score]) => ({ side, performanceScore: score ?? null }));
}

describe("normaliseSoloPerformance", () => {
  it("puts sprint and full debates on the same 0–100 per-turn scale", () => {
    expect(normaliseSoloPerformance(120, 3)).toBe(80);
    expect(normaliseSoloPerformance(400, 10)).toBe(80);
  });

  it("refuses to invent performance without answered turns", () => {
    expect(normaliseSoloPerformance(100, 0)).toBeNull();
    expect(normaliseSoloPerformance(null, 3)).toBeNull();
  });
});

describe("assignChallengeSide", () => {
  it("picks randomly with a reason when there is no history", () => {
    const result = assignChallengeSide([], { random: () => 0.1 });
    expect(result.side).toBe("for");
    expect(result.rule).toBe("random-cold-start");
    expect(result.reason).toMatch(/no history/i);
  });

  it("returns a valid side for a single past debate", () => {
    const result = assignChallengeSide(history([["for", 60]]), { random: () => 0.9 });
    expect(result.side).toBe("against");
    expect(result.rule).toBe("random-cold-start");
  });

  it("switches the side when the user heavily favours one side", () => {
    // 7 of last 8 FOR → should get AGAINST.
    const recent = history([
      ["for"], ["for"], ["against"], ["for"],
      ["for"], ["for"], ["for"], ["for"],
    ]);
    const result = assignChallengeSide(recent);
    expect(result.side).toBe("against");
    expect(result.rule).toBe("side-balance");
    expect(result.reason).toMatch(/argued FOR in 7 of your last 8/i);
  });

  it("does not trigger side-balance on a mixed record", () => {
    const recent = history([
      ["for"], ["against"], ["for"], ["against"],
      ["for"], ["against"], ["for"], ["against"],
    ]);
    const result = assignChallengeSide(recent);
    // Neither balance nor performance rules apply → alternation fallback.
    expect(result.rule).toBe("alternation-fallback");
    expect(result.side).toBe("for"); // last was "against"
  });

  it("assigns the historically weaker side on a clear performance gap", () => {
    const recent = history([
      ["for", 80], ["against", 60],
      ["for", 85], ["against", 62],
      ["for", 78], ["against", 58],
    ]);
    const result = assignChallengeSide(recent);
    expect(result.side).toBe("against");
    expect(result.rule).toBe("performance-gap");
    expect(result.reason).toMatch(/points lower/i);
  });

  it("does not create a side gap from debate length alone", () => {
    // These originated from 3-round and 10-round debates respectively, but
    // normalize to the same ability score before entering the selector.
    const sprint = normaliseSoloPerformance(120, 3);
    const full = normaliseSoloPerformance(400, 10);
    const recent = history([
      ["for", sprint], ["against", full],
      ["for", sprint], ["against", full],
    ]);
    const result = assignChallengeSide(recent);
    expect(result.rule).toBe("alternation-fallback");
  });

  it("falls back to alternation when both sides score similarly", () => {
    const recent = history([
      ["for", 70], ["against", 71],
      ["for", 69], ["against", 72],
    ]);
    const result = assignChallengeSide(recent);
    expect(result.rule).toBe("alternation-fallback");
  });

  it("only considers the last 8 debates for balance", () => {
    // Old dominance (8 FOR) followed by 8 mixed — the old ones fall outside lookback.
    const recent = history([
      ["for"], ["for"], ["for"], ["for"],
      ["for"], ["for"], ["for"], ["for"],
      ["for"], ["against"], ["for"], ["against"],
      ["for"], ["against"], ["for"], ["against"],
    ]);
    const result = assignChallengeSide(recent);
    expect(result.rule).not.toBe("side-balance");
  });
});
