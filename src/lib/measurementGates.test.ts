import { describe, it, expect } from "vitest";
import { gateBinomial, wilsonInterval, SAMPLE_GATES } from "./evidenceState";
import { assignCorpusSplit, verifyManifest } from "./corpusSplit";

describe("sample gates", () => {
  it("1/1 agreement is insufficient", () => {
    const r = gateBinomial(1, 1, SAMPLE_GATES.judgeVsConsensus);
    expect(r.state).toBe("insufficient");
    expect(r.estimate).toBeNull();
  });

  it("5/5 consensus is early", () => {
    const r = gateBinomial(5, 5, SAMPLE_GATES.humanConsensus);
    expect(r.state).toBe("early");
    expect(r.estimate).not.toBeNull();
  });

  it("50/50 consensus is reportable", () => {
    const r = gateBinomial(45, 50, SAMPLE_GATES.humanConsensus);
    expect(r.state).toBe("reportable");
  });
});

describe("uncertainty narrowing", () => {
  it("Wilson interval narrows as N increases", () => {
    const lo = wilsonInterval(8, 10);
    const hi = wilsonInterval(80, 100);
    expect(hi[1] - hi[0]).toBeLessThan(lo[1] - lo[0]);
  });
});

describe("corpus split policy (stratified)", () => {
  function makeItems(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `item-${i}`,
      familyKey: `family-${Math.floor(i / 2)}`,
      topic: ["energy", "education", "health"][i % 3],
      dynamicsTier: i % 2 === 0 ? "close" : "decisive",
      lengthBucket: i % 3 === 0 ? "short" : "long",
    }));
  }

  it("all items assigned to exactly one split", () => {
    const manifest = assignCorpusSplit(makeItems(100));
    const total = manifest.assignments.length;
    expect(total).toBe(100);
    // Balance report matches assignment counts
    const b = manifest.balance;
    expect(b.development + b.validation + b.locked).toBe(total);
  });

  it("near-duplicate families never leak across splits", () => {
    const manifest = assignCorpusSplit(makeItems(60));
    const idToSplit = new Map(manifest.assignments.map((a) => [a.itemId, a.split]));
    const famSplits = new Map<string, Set<string>>();
    for (const a of manifest.assignments) {
      const set = famSplits.get(a.familyKey) ?? new Set<string>();
      set.add(a.split);
      famSplits.set(a.familyKey, set);
    }
    for (const [fam, splits] of famSplits) {
      expect(splits.size, `Family ${fam} leaked`).toBe(1);
    }
  });

  it("is deterministic across runs", () => {
    const items = makeItems(40);
    const r1 = assignCorpusSplit(items);
    const r2 = assignCorpusSplit(items);
    expect(r1.assignments).toEqual(r2.assignments);
    expect(r1.integrityHash).toBe(r2.integrityHash);
  });

  it("manifest hash detects tampering", () => {
    const manifest = assignCorpusSplit(makeItems(20));
    expect(verifyManifestSafe(manifest)).toBe(true);
    const tampered = {
      ...manifest,
      assignments: [{ ...manifest.assignments[0], split: "locked" as const }],
    };
    expect(verifyManifestSafe(tampered)).toBe(false);
  });

  function verifyManifestSafe(m: Parameters<typeof verifyManifest>[0]): boolean {
    return verifyManifest(m);
  }
});
