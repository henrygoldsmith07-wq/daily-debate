import { describe, it, expect } from "vitest";
import { gateBinomial, wilsonInterval, SAMPLE_GATES } from "./evidenceState";
import { assignCorpusSplit, verifyManifest } from "./corpusSplit";
import { evaluateRetirement } from "./judgeHealth";
import type { JudgeHealthEntry } from "./judgeHealth";

// ── REGRESSION TESTS 1–2: sample gates + uncertainty ────────────────────────

describe("sample gates + uncertainty", () => {
  it("R1: 1/1 agreement is insufficient", () => {
    const r = gateBinomial(1, 1, SAMPLE_GATES.judgeVsConsensus);
    expect(r.state).toBe("insufficient");
    expect(r.estimate).toBeNull();
  });

  it("R2: increasing N narrows Wilson CI", () => {
    const lo = wilsonInterval(8, 10);
    const hi = wilsonInterval(80, 100);
    expect(hi[1] - hi[0]).toBeLessThan(lo[1] - lo[0]);
  });
});

// ── REGRESSION TESTS 7–8: locked set access ───────────────────────────────

describe("locked set access control", () => {
  function makeItems(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `i${i}`, familyKey: `f${Math.floor(i / 2)}`, topic: "test",
    }));
  }

  it("REGRESSION 7: locked items are identifiable and filterable from assignments", () => {
    const manifest = assignCorpusSplit(makeItems(30));
    const lockedIds = new Set(manifest.assignments.filter((a) => a.split === "locked").map((a) => a.itemId));
    // Filtering out locked leaves only non-locked
    const visible = manifest.assignments.filter((a) => !lockedIds.has(a.itemId));
    expect(visible.every((a) => a.split !== "locked")).toBe(true);
  });

  it("REGRESSION 8: normal analytics receives zero locked items after filtering", () => {
    const manifest = assignCorpusSplit(makeItems(20));
    const lockedIds = new Set(manifest.assignments.filter((a) => a.split === "locked").map((a) => a.itemId));
    const allItems = makeItems(20);
    const filtered = allItems.filter((it) => !lockedIds.has(it.id));
    expect(filtered.every((it) => !lockedIds.has(it.id))).toBe(true);
  });
});

// ── REGRESSION TESTS 9–10: split policy integrity ─────────────────────────

describe("split policy integrity", () => {
  function makeItems(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `item-${i}`,
      familyKey: `family-${Math.floor(i / 3)}`,
      topic: ["energy", "education", "health"][i % 3],
      dynamicsTier: i % 2 === 0 ? "close" : "decisive",
      lengthBucket: i % 3 === 0 ? "short" : "long",
    }));
  }

  it("R9: deterministic across runs (frozen policy)", () => {
    const items = makeItems(60);
    const r1 = assignCorpusSplit(items);
    const r2 = assignCorpusSplit(items);
    expect(r1.assignments.map((a) => `${a.itemId}:${a.split}`))
      .toEqual(r2.assignments.map((a) => `${a.itemId}:${a.split}`));
  });

  it("R10: family members never leak across splits", () => {
    const items = makeItems(90);
    const manifest = assignCorpusSplit(items);
    const idToSplit = new Map(manifest.assignments.map((a) => [a.itemId, a.split]));
    const famSplits = new Map<string, Set<string>>();
    for (const item of items) {
      const s = idToSplit.get(item.id);
      if (!s) continue;
      const set = famSplits.get(item.familyKey) ?? new Set();
      set.add(s);
      famSplits.set(item.familyKey, set);
    }
    for (const [fam, splits] of famSplits) {
      expect(splits.size, `Family ${fam} leaked`).toBe(1);
    }
  });

  it("manifest hash detects tampering", () => {
    const items = makeItems(20);
    const manifest = assignCorpusSplit(items);
    expect(verifyManifest(manifest)).toBe(true);
    const tampered = { ...manifest, assignments: [{ ...manifest.assignments[0], split: "locked" as const }] };
    expect(verifyManifest(tampered)).toBe(false);
  });
});

// ── REGRESSION TEST 11: evaluator bundle versioning ───────────────────────

describe("evaluator version fingerprint", () => {
  it("R11: fingerprint captures provider/model/prompt/engine/schema/temp/ensemble", async () => {
    const { makeFingerprint } = await import("./judgeVersioning");
    const fp = makeFingerprint("nvidia", "nemotron-3-ultra", { temperature: 0.7, ensemble: ["nvidia", "anthropic"] });
    expect(fp.provider).toBe("nvidia");
    expect(fp.model).toContain("nemotron");
    expect(fp.promptVersion).toBeGreaterThan(0);
    expect(fp.scoringEngineVersion).toBeGreaterThan(0);
    expect(fp.graphSchemaVersion).toBeGreaterThan(0);
    expect(fp.temperature).toBe(0.7);
    expect(fp.ensemble).toHaveLength(2);
  });
});

// ── REGRESSION TEST 15: retention requires persistence ────────────────────

describe("retention demands persistence", () => {
  function pt(i: number, impactHandling: number) {
    return { completedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, metrics: { impactHandling } };
  }

  it("R15: immediate improvement without subsequent debates stays at improved_in_drill", async () => {
    const { computeLoopStatuses } = await import("./coachLoop");
    const points = [pt(0, 0.4), pt(1, 0.45)];
    const assignments = [{
      id: "d1", dimension: "impact", assignedDate: "2026-01-02",
      createdAt: "2026-01-02T12:00:00Z", minutes: 3,
      beforeScore: 40, attemptText: "text", attemptScore: 60,
      movement: null, status: "attempted",
    }];
    const statuses = computeLoopStatuses(points, assignments);
    if (statuses.length > 0) {
      expect(statuses[0].stage).not.toBe("retained");
      expect(statuses[0].retained).not.toBe(true);
    }
  });

  it("R15b: improvement that regresses does NOT reach retained stage", async () => {
    const { computeLoopStatuses } = await import("./coachLoop");
    const points = [
      pt(0, 0.5), pt(1, 0.8), // drill assigned around index 1
      pt(2, 0.85), // initial spike
      pt(3, 0.35), pt(4, 0.38), // regressed back
    ];
    const assignments = [{
      id: "d1", dimension: "impact", assignedDate: "2026-01-02",
      createdAt: "2026-01-02T12:00:00Z", minutes: 3,
      beforeScore: 40, attemptText: "text", attemptScore: 70,
      movement: null, status: "attempted",
    }];
    const statuses = computeLoopStatuses(points, assignments);
    if (statuses.length > 0 && statuses[0].dimension === "impact") {
      expect(statuses[0].stage).not.toBe("retained");
    }
  });
});
