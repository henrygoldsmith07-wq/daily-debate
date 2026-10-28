// "This week in your loop": counts of what the learner actually did in the
// last 7 days, with sample gates. Pure. Observational only: no claim that
// repairs caused any change, and retest outcomes are never named here while
// a retest is pending (retestDisclosure.ts) — only completed ones are counted.

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Fewer completed observable retests than this: show counts, not a rate. */
export const MIN_RETESTS_FOR_RATE = 5;

export interface WeeklyDebate { completedAt: string | null }
export interface WeeklyRepair { createdAt: string; succeeded: boolean }
export interface WeeklyRetest {
  completedAt: string | null;
  observable: boolean | null;
  demonstrated: boolean | null;
}

export interface WeeklyLoop {
  debates: number;
  /** Debates in the 7 days before this week (observational comparison, no causal claim). */
  previousDebates: number;
  repairAttempts: number;
  repairsSucceeded: number;
  retestsCompleted: number;
  retestsObservable: number;
  retestsDemonstrated: number;
  /** Null until enough observable retests exist (all supplied, not just this week). */
  demonstratedRate: number | null;
  rateState: "insufficient_evidence" | "ok";
  /** Total observable retests behind the rate gate. */
  observableTotal: number;
  next: { kind: "retest" | "debate" | "repair" | "keep_going"; label: string; href: string };
}

function inWindow(iso: string | null, now: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= now && now - t < WEEK_MS;
}

export function buildWeeklyLoop(
  input: { debates: WeeklyDebate[]; repairs: WeeklyRepair[]; retests: WeeklyRetest[]; pendingRetests?: number },
  now: number = Date.now(),
): WeeklyLoop {
  const debates = input.debates.filter((d) => inWindow(d.completedAt, now)).length;
  const previousDebates = input.debates.filter((d) => {
    const t = d.completedAt ? Date.parse(d.completedAt) : NaN;
    return Number.isFinite(t) && t <= now - WEEK_MS && now - t < 2 * WEEK_MS;
  }).length;
  const repairs = input.repairs.filter((r) => inWindow(r.createdAt, now));
  const retests = input.retests.filter((r) => inWindow(r.completedAt, now));
  const retestsObservable = retests.filter((r) => r.observable === true);
  const retestsDemonstrated = retestsObservable.filter((r) => r.demonstrated === true).length;
  const allObservable = input.retests.filter((r) => r.completedAt && r.observable === true);
  const enough = allObservable.length >= MIN_RETESTS_FOR_RATE;
  const demonstratedRate = enough
    ? allObservable.filter((r) => r.demonstrated === true).length / allObservable.length
    : null;
  const succeeded = repairs.filter((r) => r.succeeded).length;

  let next: WeeklyLoop["next"];
  if ((input.pendingRetests ?? 0) > 0) next = { kind: "retest", label: "Take your pending retest", href: "/" };
  else if (debates === 0) next = { kind: "debate", label: "Start this week with a debate", href: "/" };
  else if (repairs.length === 0) next = { kind: "repair", label: "Repair the weakness from your last debate", href: "/history" };
  else next = { kind: "keep_going", label: "Keep the loop going with today's debate", href: "/" };

  return {
    debates,
    previousDebates,
    repairAttempts: repairs.length,
    repairsSucceeded: succeeded,
    retestsCompleted: retests.length,
    retestsObservable: retestsObservable.length,
    retestsDemonstrated,
    demonstratedRate,
    rateState: enough ? "ok" : "insufficient_evidence",
    observableTotal: allObservable.length,
    next,
  };
}
