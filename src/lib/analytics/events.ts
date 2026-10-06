// Shared event-row contract and rate primitives for product analytics.
//
// Every analytics module reads the same allowlisted, no-free-text event rows.
// The row shape, the rate contract and the small statistics helpers live here
// so funnel, retention and repair-outcome analyses cannot drift apart on how
// a rate is computed or how a sample is described.
//
// The honesty rule this file exists to enforce: below the minimum sample a
// rate is null with an explicit "not yet measurable" note. A small-n number
// presented as a percentage is the failure mode being avoided.

export const FUNNEL_MIN_SAMPLE = 5;
export const FUNNEL_DEFAULT_WINDOW_DAYS = 90;

export const DEBATE_STARTS = new Set(["sprint_started", "full_debate_started", "debate_started"]);

export interface FunnelEventRow {
  user_id: string;
  name: string;
  format: string | null;
  reason: string | null;
  created_at: string;
  /** Bounded flow identifier (debate UUID); null on legacy/pre-migration rows. */
  debate_id: string | null;
}

export interface FunnelRate {
  numerator: number;
  denominator: number;
  /** null when the denominator is below the minimum sample threshold. */
  rate: number | null;
  sample: number;
  note: string | null;
}

export interface SourceLoad {
  loaded: number;
  limit: number;
  truncated: boolean;
}

export interface DataCompleteness {
  events: SourceLoad;
  repairs: SourceLoad;
  retests: SourceLoad;
  debates: SourceLoad;
  note: string | null;
}

export function takeBounded<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } {
  if (rows.length <= limit) return { rows, truncated: false };
  return { rows: rows.slice(0, limit), truncated: true };
}

export function completenessNote(meta: DataCompleteness): string | null {
  const bits: string[] = [];
  if (meta.events.truncated) {
    bits.push(
      `event rows capped at ${meta.events.limit} — every funnel rate below may undercount; treat directions as provisional`,
    );
  }
  if (meta.repairs.truncated) {
    bits.push(
      `repair-attempt rows capped at ${meta.repairs.limit} — repair effectiveness covers only episodes represented in the newest attempts`,
    );
  }
  if (meta.retests.truncated) {
    bits.push(
      `repair-retest rows capped at ${meta.retests.limit} — deliberate retest timing and recurrence may be incomplete`,
    );
  }
  if (meta.debates.truncated) {
    bits.push(
      `debate graphs capped at ${meta.debates.limit} — weakness recurrence is measured on a subset`,
    );
  }
  return bits.length ? bits.join(" ") : null;
}

export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function median(sortedAsc: number[]): number {
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 === 1
    ? sortedAsc[mid]
    : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

export function rate(numerator: number, denominator: number, minSample: number): FunnelRate {
  const measurable = denominator >= minSample;
  return {
    numerator,
    denominator,
    rate: measurable ? +(numerator / denominator).toFixed(3) : null,
    sample: denominator,
    note: measurable
      ? null
      : `not yet measurable — ${denominator} user${denominator === 1 ? "" : "s"} (need ${minSample})`,
  };
}

export function distinctUsers(rows: FunnelEventRow[]): Set<string> {
  return new Set(rows.map((r) => r.user_id));
}

// Historical compatibility: before repair-success semantics were tightened,
// failed retries were emitted as repair_completed with reason="retry".
// Treat only successful/legacy completion rows as genuine completion.
export function isSuccessfulRepairCompletion(row: FunnelEventRow): boolean {
  return row.name === "repair_demonstrated" || (row.name === "repair_completed" && row.reason !== "retry");
}

/** New repair_attempted plus legacy completion rows, which necessarily imply an attempt. */
export function isRepairAttempt(row: FunnelEventRow): boolean {
  return row.name === "repair_attempted" || row.name === "repair_completed";
}

/**
 * Every event name that participates in a funnel step.
 */
export const FUNNEL_EVENT_NAMES = [
  ...DEBATE_STARTS,
  "debate_completed",
  "repair_started",
  "repair_attempted",
  "repair_demonstrated",
  "repair_completed",
  "retest_started",
  "retest_completed",
  "retest_skill_demonstrated",
  "full_analysis_opened",
] as const;
