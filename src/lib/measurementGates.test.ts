import { describe, it, expect } from "vitest";
import { gateBinomial, wilsonInterval, SAMPLE_GATES } from "./evidenceState";
import { assignCorpusSplit } from "./corpusSplit";

// ── REGRESSION TEST 1: 1/1 cannot produce reportable headline ──────────────
describe("sample gates", () => {
  it("1/1 judge agreement is insufficient, not reportable", () => {
    const r = gateBinomial(1, 1, SAMPLE_GATES.judgeVsConsensus);
    expect(r.state).toBe("insufficient");
    expect(r.estimate).toBeNull();
  });

  it("5/5 consensus is early (visible but not definitive)", () => {
    const r = gateBinomial(5, 5, SAMPLE_GATES.humanConsensus);
    expect(r.state).toBe("early");
    expect(r.estimate).not.toBeNull();
  });

  it("50/50 consensus is reportable", () => {
    const r = gateBinomial(45, 50, SAMPLE_GATES.humanConsensus);
    expect(r.state).toBe("reportable");
  });
});

// ── REGRESSION TEST 2: increasing N narrows uncertainty ────────────────────
describe("uncertainty narrowing", () => {
  it("Wilson interval narrows as N increases", () => {
    const small = wilsonInterval(8, 10); // n=10
    const large = wilsonInterval(80, 100); // n=100
    const widthSmall = small[1] - small[0];
    const widthLarge = large[1] - large[0];
    expect(widthLarge).toBeLessThan(widthSmall);
  });

  it("gated metric carries narrower CI at larger N", () => {
    const small = gateBinomial(8, 10, SAMPLE_GATES.judgeVsConsensus);
    // Force past early threshold by adding more data
    const large = gateBinomial(80, 100, SAMPLE_GATES.judgeVsConsensus);
    if (small.ciLower !== null && small.ciUpper !== null && large.ciLower !== null && large.ciUpper !== null) {
      expect(large.ciUpper - large.ciLower).toBeLessThan(small.ciUpper - small.ciLower);
    }
  });
});

// ── REGRESSION TESTS 9-10: corpus split policy ──────────────────────────────
describe("corpus split policy", () => {
  function makeItems(n: number): Array<{ id: string; familyKey: string; topic: string }> {
    return Array.from({ length: n }, (_, i) => ({
      id: `item-${i}`,
      familyKey: `family-${Math.floor(i / 2)}`, // pairs stay together
      topic: ["energy", "education", "health"][i % 3],
    }));
  }

  it("assigns items to all three splits with reasonable proportions", () => {
    const items = makeItems(100);
    const result = assignCorpusSplit(items);
    const total = result.development.length + result.validation.length + result.locked.length;
    expect(total).toBe(100);
    expect(result.development.length).toBeGreaterThan(result.validation.length);
    expect(result.development.length).toBeGreaterThan(result.locked.length);
    expect(result.validation.length).toBeGreaterThan(0);
    expect(result.locked.length).toBeGreaterThan(0);
  });

  it("near-duplicate families never leak across splits", () => {
    const items = makeItems(60); // 30 families of 2
    const result = assignCorpusSplit(items);
    // Every item in a family must be in the same split
    const idToSplit = new Map<string, string>();
    for (const split of ["development", "validation", "locked"] as const) {
      for (const id of result[split]) idToSplit.set(id, split);
    }
    const familySplits = new Map<string, Set<string>>();
    for (const item of items) {
      const split = idToSplit.get(item.id);
      if (!split) continue;
      const set = familySplits.get(item.familyKey) ?? new Set();
      set.add(split);
      familySplits.set(item.familyKey, set);
    }
    for (const [family, splits] of familySplits) {
      expect(splits.size, `family ${family} leaked across splits`).toBe(1);
    }
  });

  it("is deterministic across runs", () => {
    const items = makeItems(40);
    const r1 = assignCorpusSplit(items);
    const r2 = assignCorpusSplit(items);
    expect(r1.development).toEqual(r2.development);
    expect(r1.validation).toEqual(r2.validation);
    expect(r1.locked).toEqual(r2.locked);
  });
});
