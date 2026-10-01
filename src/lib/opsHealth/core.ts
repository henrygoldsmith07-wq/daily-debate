// Shared health vocabulary.
//
// Every subsystem reports one of these states. The roll-up is deliberately
// not an average: an unresolved subsystem outranks a healthy one, so missing
// evidence is visibly unresolved rather than washed green.

export type HealthState = "healthy" | "degraded" | "blocked" | "stale" | "failed" | "unknown";

/**
 * Explicit roll-up severity order — an unresolved subsystem can never be
 * averaged away: failed > blocked > stale > degraded > unknown > healthy.
 * "unknown" sits ABOVE healthy deliberately: missing evidence is visibly
 * unresolved, not green.
 */
export const STATE_SEVERITY: Record<HealthState, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  stale: 3,
  blocked: 4,
  failed: 5,
};

export function rollupOverall(states: HealthState[]): HealthState {
  let worst: HealthState = "healthy";
  for (const s of states) {
    if (STATE_SEVERITY[s] > STATE_SEVERITY[worst]) worst = s;
  }
  return worst;
}

export function dayDiffUtc(laterIso: string, earlierIso: string): number {
  return Math.floor(
    (Date.parse(`${laterIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${earlierIso.slice(0, 10)}T00:00:00Z`)) / 86_400_000,
  );
}

export function todayIsoUtc(nowIso: string): string {
  return new Date(nowIso).toISOString().slice(0, 10);
}

export function addDaysUtc(dayIso: string, days: number): string {
  const d = new Date(`${dayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
