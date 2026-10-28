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
