import { describe, expect, it } from "vitest";
import { detectRecurrence } from "./recurrenceAlert";
import type { ChainEntry } from "./loopChain";

const e = (kind: string, stage: string, repairedAt: string) => ({ targetKind: kind, stage, repairedAt }) as unknown as ChainEntry;

describe("detectRecurrence", () => {
  it("null without a new weakness or prior repair", () => {
    expect(detectRecurrence([], "logic", "2026-10-29")).toBeNull();
    expect(detectRecurrence([e("logic", "retest_pending", "2026-10-01")], null, "2026-10-29")).toBeNull();
  });
  it("one prior repair is insufficient_evidence", () => {
    expect(detectRecurrence([e("logic", "retest_demonstrated", "2026-10-01")], "logic", "2026-10-29")?.evidence).toBe("insufficient_evidence");
  });
  it("two prior repairs say came_back; unlanded repairs and later ones ignored", () => {
    const chain = [e("logic", "retest_demonstrated", "2026-10-01"), e("logic", "retest_pending", "2026-10-10"), e("logic", "repair_not_landed", "2026-10-15"), e("logic", "retest_pending", "2026-11-05"), e("impact", "retest_pending", "2026-10-02")];
    const r = detectRecurrence(chain, "logic", "2026-10-29");
    expect(r).toEqual({ kind: "logic", repairedAt: "2026-10-10", evidence: "came_back" });
  });
});
