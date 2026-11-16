import { describe, expect, it } from "vitest";
import { buildLoopChain } from "./loopChain";

const rep = (id: string, at: string, succeeded = true) => ({ id, targetKind: "evidence" as const, createdAt: at, succeeded });
const rt = (id: string, p: Partial<{ completedAt: string | null; observable: boolean | null; demonstrated: boolean | null }>) => ({
  repairResultId: id, assignedAt: "2026-10-02T00:00:00Z", completedAt: null, observable: null, demonstrated: null, ...p,
});

describe("buildLoopChain", () => {
  it("never names an outcome while the retest is pending", () => {
    const [e] = buildLoopChain([rep("a", "2026-10-01T00:00:00Z")], [rt("a", {})]);
    expect(e.stage).toBe("retest_pending");
    expect(e.retestAssignments).toBe(1);
  });
  it("uses the latest observable retest over an earlier unobservable one", () => {
    const [e] = buildLoopChain([rep("a", "2026-10-01T00:00:00Z")], [
      rt("a", { completedAt: "2026-10-03T00:00:00Z", observable: false }),
      rt("a", { completedAt: "2026-10-05T00:00:00Z", observable: true, demonstrated: true }),
    ]);
    expect(e.stage).toBe("retest_demonstrated");
  });
  it("marks unobservable, not-demonstrated, and unlanded repairs distinctly", () => {
    const out = buildLoopChain(
      [rep("a", "2026-10-01T00:00:00Z"), rep("b", "2026-10-02T00:00:00Z"), rep("c", "2026-10-03T00:00:00Z", false)],
      [rt("a", { completedAt: "2026-10-04T00:00:00Z", observable: false }), rt("b", { completedAt: "2026-10-04T00:00:00Z", observable: true, demonstrated: false })],
    );
    expect(out.map((e) => e.stage)).toEqual(["repair_not_landed", "retest_not_demonstrated", "retest_not_observable"]);
    expect(out.every((e) => e.recurrence === "insufficient_evidence")).toBe(true);
  });
  it("skips bad timestamps and respects the limit", () => {
    expect(buildLoopChain([rep("a", "nope")], [])).toEqual([]);
    const many = Array.from({ length: 5 }, (_, i) => rep(String(i), `2026-10-0${i + 1}T00:00:00Z`));
    expect(buildLoopChain(many, [], 2)).toHaveLength(2);
  });
});

import { summarizeChain, CHAIN_RATE_MIN_DECIDED, type ChainEntry } from "./loopChain";
describe("summarizeChain", () => {
  const mk = (stage: ChainEntry["stage"], i: number): ChainEntry => ({ repairId: `r${i}`, targetKind: "logic", repairedAt: "2026-10-01T00:00:00Z", stage, retestAssignments: 1, completedAt: null, recurrence: "insufficient_evidence" });
  it("withholds a share below the gate", () => {
    const s = summarizeChain([mk("retest_demonstrated", 1), mk("retest_pending", 2)]);
    expect(s).toMatchObject({ decided: 1, pending: 1, demonstratedShare: null, status: "insufficient_evidence" });
  });
  it("gives a share at the gate, ignoring not-observable", () => {
    const es = Array.from({ length: CHAIN_RATE_MIN_DECIDED }, (_, i) => mk(i < 4 ? "retest_demonstrated" : "retest_not_demonstrated", i));
    es.push(mk("retest_not_observable", 99));
    expect(summarizeChain(es)).toMatchObject({ decided: 10, demonstrated: 4, demonstratedShare: 0.4, status: "ok" });
  });
});

import { summarizeChainByKind } from "./loopChain";
describe("summarizeChainByKind", () => {
  it("gates each skill independently", () => {
    const mk = (i: number, kind: "logic" | "impact", demo: boolean) => ({ repairId: `${kind}${i}`, targetKind: kind, repairedAt: "2026-10-01T00:00:00Z", stage: demo ? ("retest_demonstrated" as const) : ("retest_not_demonstrated" as const), retestAssignments: 1, completedAt: "2026-10-02T00:00:00Z", recurrence: "insufficient_evidence" as const });
    const entries = [...Array.from({ length: 10 }, (_, i) => mk(i, "logic", i < 6)), mk(0, "impact", true)];
    const out = summarizeChainByKind(entries);
    expect(out.find((k) => k.kind === "logic")?.demonstratedShare).toBe(0.6);
    expect(out.find((k) => k.kind === "impact")?.demonstratedShare).toBeNull();
  });
});
