import { describe, expect, it } from "vitest";
import {
  GUEST_FOCUS_LABEL,
  firstFocusView,
  guestKindToDimension,
  guestSeededFocus,
  resolveFirstFocus,
} from "./guestFocus";
import type { GuestLoopSummary } from "./guestLoop";

const guest = (weaknessKind: string): GuestLoopSummary => ({
  motion: "m",
  weaknessKind,
  weaknessLabel: "L",
  repairState: "repair_demonstrated",
  repairSucceeded: true,
  retestOutcome: "observed",
  completedAt: "2026-10-20T10:00:00.000Z",
});

describe("guest-seeded first focus", () => {
  it("maps only guest kinds a coach dimension honestly measures", () => {
    expect(guestKindToDimension("reasoning")).toBe("logic");
    expect(guestKindToDimension("evidence")).toBe("evidence");
    expect(guestKindToDimension("rebuttal")).toBe("rebuttal");
    expect(guestKindToDimension("impact")).toBe("impact");
    expect(guestKindToDimension("claim")).toBeNull();
  });

  it("seeds only while the account has no evidence of its own", () => {
    const base = { guestContext: guest("evidence"), hasCompletedDebate: false, ledgerPointCount: 0 };
    expect(guestSeededFocus(base)).toBe("evidence");
    expect(guestSeededFocus({ ...base, hasCompletedDebate: true })).toBeNull();
    expect(guestSeededFocus({ ...base, ledgerPointCount: 1 })).toBeNull();
    expect(guestSeededFocus({ ...base, guestContext: null })).toBeNull();
    expect(guestSeededFocus({ ...base, excluded: ["evidence"] })).toBeNull();
  });

  it("lets the learner change or drop the seed, but never without one", () => {
    expect(resolveFirstFocus({ seeded: "evidence", requested: undefined })).toEqual({
      dimension: "evidence",
      source: "guest-practice",
    });
    expect(resolveFirstFocus({ seeded: "evidence", requested: "impact" })).toEqual({
      dimension: "impact",
      source: "learner-choice",
    });
    expect(resolveFirstFocus({ seeded: "evidence", requested: "none" })).toEqual({ dimension: null, source: null });
    expect(resolveFirstFocus({ seeded: "evidence", requested: "impact", excluded: ["impact"] }).dimension).toBe(
      "evidence",
    );
    expect(resolveFirstFocus({ seeded: null, requested: "impact" })).toEqual({ dimension: null, source: null });
  });

  it("labels the view unvalidated and offers every non-excluded skill", () => {
    const view = firstFocusView("logic", ["rebuttal"]);
    expect(view?.label).toBe(GUEST_FOCUS_LABEL);
    expect(view?.label).toMatch(/unvalidated/i);
    expect(view?.suggested).toBe("logic");
    expect(view?.options.map((o) => o.key)).not.toContain("rebuttal");
    expect(view?.options.map((o) => o.key)).toContain("logic");
    expect(firstFocusView(null)).toBeNull();
  });
});
