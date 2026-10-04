// Guest practice-loop carry-through.
//
// A guest who completes the full loop (debate -> one weakness -> repair ->
// retest) has produced a result worth keeping. This module defines the bounded
// summary shape and the validation shared by the client (which stores it in
// localStorage for the signup form) and the server (which writes it to
// profiles.guest_context after signup). Never free text beyond bounded fields,
// never a trust boundary: the server re-validates everything.

export interface GuestLoopSummary {
  motion: string;
  weaknessKind: string;
  weaknessLabel: string;
  repairState: string;
  repairSucceeded: boolean;
  retestOutcome: "observed" | "not-observed";
  completedAt: string;
}

export const GUEST_LOOP_STORAGE_KEY = "daily-debate-guest-loop";

const KINDS = new Set(["claim", "reasoning", "rebuttal", "impact", "evidence"]);
const REPAIR_STATES = new Set(["needs_another_pass", "partially_repaired", "repair_demonstrated"]);
const RETEST_OUTCOMES = new Set(["observed", "not-observed"]);

/**
 * Validate and bound a guest-loop payload. Accepts a parsed object or a JSON
 * string (what the signup form posts). Returns null for anything malformed —
 * a bad payload is dropped silently, never stored and never fatal.
 */
export function parseGuestLoopSummary(raw: unknown): GuestLoopSummary | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (!raw || raw.length > 4000) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  if (typeof v.weaknessKind !== "string" || !KINDS.has(v.weaknessKind)) return null;
  if (typeof v.repairState !== "string" || !REPAIR_STATES.has(v.repairState)) return null;
  if (typeof v.retestOutcome !== "string" || !RETEST_OUTCOMES.has(v.retestOutcome)) return null;

  return {
    motion: boundedString(v.motion, 200),
    weaknessKind: v.weaknessKind,
    weaknessLabel: boundedString(v.weaknessLabel, 100),
    repairState: v.repairState,
    repairSucceeded: v.repairSucceeded === true,
    retestOutcome: v.retestOutcome as GuestLoopSummary["retestOutcome"],
    completedAt: boundedString(v.completedAt, 40) || new Date().toISOString(),
  };
}

function boundedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Serialize for the hidden signup field (bounded by construction). */
export function encodeGuestLoopSummary(summary: GuestLoopSummary): string {
  return JSON.stringify(summary);
}
