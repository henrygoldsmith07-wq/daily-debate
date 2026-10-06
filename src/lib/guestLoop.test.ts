import { describe, expect, it } from "vitest";
import {
  classifyGuestContextWriteError,
  encodeGuestLoopSummary,
  guestContextWriteFailureLog,
  parseGuestLoopSummary,
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
