import { describe, expect, it } from "vitest";
import { ladderCopy, ladderState } from "./retestLadder";

describe("retestLadder", () => {
  it("claims nothing below the observed sample gate", () => {
    const s = ladderState(["passed"]);
    expect(s.status).toBe("insufficient_evidence");
    expect(s.level).toBe("standard");
    expect(ladderCopy(s)).toMatch(/Not enough/);
  });
  it("steps up after two consecutive passes and offers it", () => {
    const s = ladderState(["passed", "passed"]);
    expect(s.level).toBe("tougher");
    expect(s.status).toBe("offer");
  });
  it("a failure steps back and resets the streak", () => {
    const s = ladderState(["passed", "passed", "failed"]);
    expect(s.level).toBe("standard");
    expect(s.status).toBe("stepped-back");
  });
  it("ignores inconclusive outcomes", () => {
    expect(ladderState(["passed", "inconclusive", "passed"]).level).toBe("tougher");
  });
  it("caps at the top level with no further offer", () => {
    const s = ladderState(["passed", "passed", "passed", "passed", "passed", "passed"]);
    expect(s.level).toBe("hardest");
    expect(s.offerLevel).toBeNull();
  });
});
