/**
 * How often stored repair/retest outcomes moved the coach's focus.
 * Counts only: it says what the coach did, never whether steering helped
 * (that needs the retest arm, which has its own sample gates).
 */
export interface SteeringRow {
  steering?: string | null;
  dimension?: string | null;
}

export interface SteeringSummary {
  total: number;
  reRepair: number;
  movedOn: number;
  unsteered: number;
  /** null below the sample gate: a share of a handful of debates is noise. */
  steeredShare: number | null;
  note: string;
}

export const STEERING_MIN_SAMPLE = 20;

export function summariseSteering(rows: SteeringRow[], minSample = STEERING_MIN_SAMPLE): SteeringSummary {
  let reRepair = 0;
  let movedOn = 0;
  let unsteered = 0;
  for (const r of rows) {
    if (!r.dimension) continue; // no focus assigned: nothing to steer
    if (r.steering === "re_repair") reRepair++;
    else if (r.steering === "moved_on") movedOn++;
    else unsteered++;
  }
  const total = reRepair + movedOn + unsteered;
  const enough = total >= minSample;
  return {
    total,
    reRepair,
    movedOn,
    unsteered,
    steeredShare: enough ? (reRepair + movedOn) / total : null,
    note: enough
      ? "Counts of how the focus was picked. Not evidence that steering improves learning."
      : `insufficient_evidence: ${total} of ${minSample} debates with a focus needed before a share is shown.`,
  };
}
