import { describe, expect, it } from "vitest";
import {
  classifyGuestContextWriteError,
  encodeGuestArenaProgress,
  encodeGuestLoopSummary,
  guestCarryoverNotes,
  guestContextWriteFailureLog,
  GUEST_ARENA_STORAGE_KEY,
  parseGuestArenaProgress,
  parseGuestLoopSummary,
  type GuestArenaProgress,
  type GuestLoopSummary,
} from "./guestLoop";

const valid: GuestLoopSummary = {
  motion: "Should every school day include a phone-free hour?",
  weaknessKind: "evidence",
  weaknessLabel: "Unsupported claim",
  repairState: "repair_demonstrated",
  repairSucceeded: true,
  retestOutcome: "observed",
  completedAt: "2026-10-04T00:00:00.000Z",
};

describe("guest repair text carry-over", () => {
  it("keeps a bounded repair text and omits it when blank", () => {
    const kept = parseGuestLoopSummary({ ...valid, repairText: "  Because X, so Y.  " });
    expect(kept!.repairText).toBe("Because X, so Y.");
    expect(parseGuestLoopSummary({ ...valid, repairText: "x".repeat(2000) })!.repairText).toHaveLength(800);
    expect("repairText" in parseGuestLoopSummary({ ...valid, repairText: "   " })!).toBe(false);
  });
});

describe("parseGuestLoopSummary", () => {
  it("accepts a well-formed payload from either shape", () => {
    expect(parseGuestLoopSummary(valid)).not.toBeNull();
    expect(parseGuestLoopSummary(encodeGuestLoopSummary(valid))).toEqual(valid);
  });

  it("drops payloads with invalid enum values", () => {
    expect(parseGuestLoopSummary({ ...valid, weaknessKind: "pvp" })).toBeNull();
    expect(parseGuestLoopSummary({ ...valid, repairState: "mastered" })).toBeNull();
    expect(parseGuestLoopSummary({ ...valid, retestOutcome: "mastery" })).toBeNull();
  });

  it("accepts a signup before the retest as not-run, never as observed", () => {
    const parsed = parseGuestLoopSummary({ ...valid, retestOutcome: "not-run" });
    expect(parsed).not.toBeNull();
    expect(parsed!.retestOutcome).toBe("not-run");
    expect(parsed!.repairSucceeded).toBe(true);
  });

  it("drops malformed JSON and non-objects", () => {
    expect(parseGuestLoopSummary("{not json")).toBeNull();
    expect(parseGuestLoopSummary(42)).toBeNull();
    expect(parseGuestLoopSummary(null)).toBeNull();
  });

  it("bounds free-text fields and tolerates missing ones", () => {
    const longMotion = "m".repeat(5000);
    const parsed = parseGuestLoopSummary({ ...valid, motion: longMotion, weaknessLabel: 7 });
    expect(parsed).not.toBeNull();
    expect(parsed!.motion.length).toBe(200);
    expect(parsed!.weaknessLabel).toBe("");
    expect(parsed!.completedAt).toMatch(/^\d{4}-/);
  });

  it("drops payloads over the wire-size cap", () => {
    expect(parseGuestLoopSummary("x".repeat(4001))).toBeNull();
  });

  it("keeps a demonstrated drill distinct from an unobserved transfer", () => {
    // Regression: the client once wrote `repairSucceeded` from the retest
    // reading, so a good drill whose move did not reappear under pressure was
    // stored as a failed repair. The drill outcome and the transfer reading
    // must be able to disagree — that disagreement is the honest record.
    const drillGoodTransferMissed = {
      ...valid,
      repairState: "repair_demonstrated",
      repairSucceeded: true,
      retestOutcome: "not-observed",
    };
    expect(parseGuestLoopSummary(drillGoodTransferMissed)).toEqual(drillGoodTransferMissed);
  });
});

describe("guest_context write-failure classification (schema-lag tolerance)", () => {
  it("logs nothing when the write succeeded", () => {
    expect(classifyGuestContextWriteError(null)).toBeNull();
    expect(classifyGuestContextWriteError(undefined)).toBeNull();
    expect(guestContextWriteFailureLog(null)).toBeNull();
    expect(guestContextWriteFailureLog(undefined)).toBeNull();
  });

  it("logs a bounded diagnostic when an error object carries no usable fields", () => {
    // The builder's errorResult always attaches a message, but defensively an
    // empty error object must still be visible, not silent.
    expect(classifyGuestContextWriteError({ message: null, code: null })).toBe("other");
    expect(guestContextWriteFailureLog({ message: null, code: null })).toContain("unknown error");
  });

  it("treats the Postgres undefined-column SQLSTATE as a schema-lagging database", () => {
    // Migration 036 not applied: node-postgres reports 42703 with a message
    // naming the column.
    const error = { code: "42703", message: 'column profiles.guest_context of relation "profiles" does not exist' };
    expect(classifyGuestContextWriteError(error)).toBe("schema-lagging");
    const log = guestContextWriteFailureLog(error);
    expect(log).toContain("migration 036");
    expect(log).toContain("guest_context");
    expect(log).toContain("signup unaffected");
  });

  it("detects the missing column from the message when no SQLSTATE survives", () => {
    const error = { message: "column guest_context does not exist" };
    expect(classifyGuestContextWriteError(error)).toBe("schema-lagging");
  });

  it("classifies every other failure as non-schema, with a bounded one-line diagnostic", () => {
    const error = { code: "23505", message: "duplicate key value violates unique constraint" };
    expect(classifyGuestContextWriteError(error)).toBe("other");
    const log = guestContextWriteFailureLog(error);
    expect(log).toContain("carry-through write failed");
    expect(log).toContain("23505");
    expect(log!.length).toBeLessThanOrEqual(280);
  });

  it("bounds and tolerates junk error payloads", () => {
    const longMessage = "e".repeat(5000);
    const log = guestContextWriteFailureLog({ message: longMessage });
    expect(log).toContain("carry-through write failed");
    expect(log!.length).toBeLessThan(300);
    expect(classifyGuestContextWriteError({ message: undefined, code: undefined })).toBe("other");
  });

  it("does not misread an unrelated 42703 on a different column as schema lag for 036", () => {
    // A missing column elsewhere is still an "other" failure: the fallback
    // message path only claims schema lag when the guest_context column is
    // the one named. The SQLSTATE path stays authoritative for the builder's
    // typed update (it can only target guest_context).
    const error = { code: "08003", message: "connection does not exist" };
    expect(classifyGuestContextWriteError(error)).toBe("other");
  });
});

const validProgress: GuestArenaProgress = {
  version: 1,
  motionDate: "2026-10-16",
  stage: "result",
  side: "for",
  responses: ["First response.", "Second response."],
  repair: { kind: "evidence", label: "Missing evidence", text: "According to UNESCO.", succeeded: true },
  retestDemonstrated: null,
};

describe("parseGuestArenaProgress", () => {
  it("round-trips a well-formed snapshot", () => {
    expect(parseGuestArenaProgress(validProgress)).toEqual(validProgress);
    expect(parseGuestArenaProgress(encodeGuestArenaProgress(validProgress))).toEqual(validProgress);
    expect(GUEST_ARENA_STORAGE_KEY).toBe("daily-debate-guest-arena");
  });

  it("accepts every stage and a null repair", () => {
    for (const stage of ["home", "debate", "result", "retest", "done"] as const) {
      expect(parseGuestArenaProgress({ ...validProgress, stage, repair: null })?.stage).toBe(stage);
    }
  });

  it("drops corrupt, oversized, and version-skewed payloads", () => {
    expect(parseGuestArenaProgress("{not json")).toBeNull();
    expect(parseGuestArenaProgress(42)).toBeNull();
    expect(parseGuestArenaProgress(null)).toBeNull();
    expect(parseGuestArenaProgress("x".repeat(40_001))).toBeNull();
    expect(parseGuestArenaProgress({ ...validProgress, version: 2 })).toBeNull();
  });

  it("drops payloads with invalid enums, shapes, or bounds", () => {
    expect(parseGuestArenaProgress({ ...validProgress, stage: "mastery" })).toBeNull();
    expect(parseGuestArenaProgress({ ...validProgress, side: "challenge" })).toBeNull();
    expect(parseGuestArenaProgress({ ...validProgress, motionDate: "yesterday" })).toBeNull();
    expect(parseGuestArenaProgress({ ...validProgress, responses: "nope" })).toBeNull();
    expect(parseGuestArenaProgress({ ...validProgress, responses: Array(9).fill("x") })).toBeNull();
    expect(parseGuestArenaProgress({ ...validProgress, repair: { kind: "pvp", label: "x", text: "y", succeeded: true } })).toBeNull();
    expect(parseGuestArenaProgress({ ...validProgress, retestDemonstrated: "observed" })).toBeNull();
  });

  it("bounds long text instead of dropping the snapshot", () => {
    const parsed = parseGuestArenaProgress({
      ...validProgress,
      responses: ["r".repeat(9000)],
      repair: { kind: "evidence", label: "l".repeat(500), text: "t".repeat(9000), succeeded: false },
    });
    expect(parsed?.responses[0].length).toBe(4000);
    expect(parsed?.repair?.label.length).toBe(100);
    expect(parsed?.repair?.text.length).toBe(4000);
  });
});

describe("parseGuestArenaProgress — live guest sprint", () => {
  const live = {
    motion: { title: "Should cities ban cars?", prompt: "Weigh access against air quality.", category: "Policy" },
    persona: "skeptic" as const,
    opponents: ["Opening.", "Second."],
    retest: null,
  };

  it("round-trips a live snapshot with its transcript", () => {
    const progress = { ...validProgress, stage: "debate" as const, mode: "live" as const, live };
    expect(parseGuestArenaProgress(encodeGuestArenaProgress(progress))).toEqual(progress);
  });

  it("treats a snapshot without a mode as guided (older builds)", () => {
    expect(parseGuestArenaProgress(validProgress)?.mode).toBeUndefined();
  });

  it("never half-restores a live sprint whose transcript is missing or malformed", () => {
    expect(parseGuestArenaProgress({ ...validProgress, stage: "debate", mode: "live" })).toBeNull();
    expect(parseGuestArenaProgress({ ...validProgress, mode: "pvp" })).toBeNull();
    expect(parseGuestArenaProgress({ ...validProgress, mode: "live", live: { ...live, opponents: ["a", "b", "c", "d"] } })).toBeNull();
    expect(parseGuestArenaProgress({ ...validProgress, mode: "live", live: { ...live, motion: { title: "" } } })).toBeNull();
  });

  it("restores a live home snapshot without a transcript", () => {
    expect(parseGuestArenaProgress({ ...validProgress, stage: "home", mode: "live" })?.mode).toBe("live");
  });

  it("falls back to the balanced opponent for an unknown persona", () => {
    const parsed = parseGuestArenaProgress({ ...validProgress, mode: "live", live: { ...live, persona: "villain" } });
    expect(parsed?.live?.persona).toBe("balanced");
  });
});

describe("guestCarryoverNotes", () => {
  it("flags a not-run retest and trims repair text", () => {
    expect(guestCarryoverNotes({ retestOutcome: "not-run", repairText: "  my fix  " })).toEqual({
      repairText: "my fix",
      retestNotRun: true,
    });
  });
  it("shows no note for an observed retest or missing context", () => {
    expect(guestCarryoverNotes({ retestOutcome: "observed", repairText: "  " })).toEqual({
      repairText: null,
      retestNotRun: false,
    });
    expect(guestCarryoverNotes(null)).toEqual({ repairText: null, retestNotRun: false });
  });
});
