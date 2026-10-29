import { describe, expect, it } from "vitest";
import { detectRecurrence, summarizeRecurrenceByKind, RECURRENCE_MIN_REPAIRS } from "./recurrenceAlert";
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

import { recurrenceAlertNote } from "./recurrenceAlert";
describe("recurrenceAlertNote", () => {
  it("never claims failure on a single repeat", () => {
    const t = recurrenceAlertNote({ kind: "evidence", repairedAt: "2026-10-01", evidence: "insufficient_evidence" });
    expect(t).toMatch(/not enough evidence/);
  });
  it("labels repeated as unvalidated", () => {
    expect(recurrenceAlertNote({ kind: "logic", repairedAt: "2026-10-01", evidence: "came_back" })).toMatch(/not a validated/);
  });
});

describe("summarizeRecurrenceByKind", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ targetKind: "logic", stage: "retest_pending", repairedAt: new Date(2026, 0, i + 1).toISOString() })) as never[];
  it("gates share below the sample minimum", () => {
    const r = summarizeRecurrenceByKind(mk(3));
    expect(r[0]).toMatchObject({ repairs: 3, repeated: 2, share: null });
  });
  it("reports share at the minimum", () => {
    expect(summarizeRecurrenceByKind(mk(RECURRENCE_MIN_REPAIRS))[0].share).toBeCloseTo(0.9);
  });
});
