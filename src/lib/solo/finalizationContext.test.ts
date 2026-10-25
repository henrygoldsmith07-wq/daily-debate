import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/repairEffectiveness", () => ({
  countWeaknessesForSide: (graph: { n: number }) => ({ circular: graph.n }),
}));

import { buildPriorDebateKinds } from "./finalizationContext";
import type { ObservableAssessment } from "@/lib/observableAssessment";

const assessment = (n: number) => ({ graph: { n } }) as unknown as ObservableAssessment;

describe("buildPriorDebateKinds", () => {
  it("returns oldest-first using the stored completion times", () => {
    const merged = new Map([["new", assessment(2)], ["old", assessment(1)]]);
    const out = buildPriorDebateKinds(
      [
        { id: "new", completed_at: "2026-10-20T10:00:00Z" },
        { id: "old", completed_at: "2026-10-10T10:00:00Z" },
      ],
      merged,
    );
    expect(out).toEqual([
      { completedAt: "2026-10-10T10:00:00Z", kinds: { circular: 1 } },
      { completedAt: "2026-10-20T10:00:00Z", kinds: { circular: 2 } },
    ]);
  });

  it("drops debates with missing or unparseable completion times instead of stamping now", () => {
    const merged = new Map([["a", assessment(1)], ["b", assessment(2)], ["c", assessment(3)]]);
    const out = buildPriorDebateKinds(
      [
        { id: "a", completed_at: null },
        { id: "b", completed_at: "garbage" },
        { id: "c", completed_at: "2026-10-01T00:00:00Z" },
      ],
      merged,
    );
    expect(out).toEqual([{ completedAt: "2026-10-01T00:00:00Z", kinds: { circular: 3 } }]);
  });

  it("skips debates with no merged assessment", () => {
    expect(buildPriorDebateKinds([{ id: "x", completed_at: "2026-10-01T00:00:00Z" }], new Map())).toEqual([]);
  });
});
