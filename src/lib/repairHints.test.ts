import { describe, expect, it } from "vitest";
import { clampHelpLevel, helpFor, maxUnlockedLevel, statsByHelpLevel } from "./repairHints";

describe("repair hint ladder", () => {
  it("locks help until a failed attempt", () => {
    expect(maxUnlockedLevel(0)).toBe(0);
    expect(maxUnlockedLevel(1)).toBe(1);
    expect(maxUnlockedLevel(7)).toBe(3);
    expect(maxUnlockedLevel(NaN)).toBe(0);
    expect(clampHelpLevel(3, 1)).toBe(1);
    expect(clampHelpLevel("x", 3)).toBe(0);
    expect(clampHelpLevel(-2, 3)).toBe(0);
  });
  it("returns no help at level 0 and quotes the learner at level 3", () => {
    const t = { kind: "evidence" as const, sourceText: "Remote work is better." };
    expect(helpFor(t, 0)).toBeNull();
    expect(helpFor(t, 1)?.label).toBe("Hint");
    expect(helpFor(t, 3)?.text).toContain("Remote work is better.");
  });
  it("withholds rates below the sample gate", () => {
    const few = statsByHelpLevel([{ helpLevel: 1, demonstrated: true }]);
    expect(few[1].rate).toBeNull();
    expect(few[1].state).toBe("insufficient_evidence");
    const many = statsByHelpLevel(Array.from({ length: 10 }, (_, i) => ({ helpLevel: 2 as const, demonstrated: i < 4 })));
    expect(many[2].rate).toBe(0.4);
    expect(many[2].state).toBe("unvalidated");
  });
});

import { helpLevelFromSignals, tagHelpSignal, unlockedHelp, visibleSignals } from "./repairHints";

describe("help signal tagging and unlocked ladder", () => {
  it("round-trips the help level without leaking into visible signals", () => {
    const tagged = tagHelpSignal(["a", "help_level:1"], 2);
    expect(helpLevelFromSignals(tagged)).toBe(2);
    expect(visibleSignals(tagged)).toEqual(["a"]);
    expect(helpLevelFromSignals(["x"])).toBe(0);
    expect(helpLevelFromSignals(null)).toBe(0);
  });
  it("unlocks nothing before a failed attempt and caps at three", () => {
    const t = { kind: "evidence" as const, sourceText: "x" };
    expect(unlockedHelp(t, 0)).toEqual([]);
    expect(unlockedHelp(t, 2).map((h) => h.level)).toEqual([1, 2]);
    expect(unlockedHelp(t, 9).map((h) => h.level)).toEqual([1, 2, 3]);
  });
});
