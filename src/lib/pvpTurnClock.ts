/**
 * The PvP turn clock (the Geo pattern: "you get a turn, you get a clock").
 *
 * One deadline, owned by the server: a turn starts when the server stamps
 * pvp_matches.turn_started_at, and lasts PVP_TURN_SECONDS. The turn route
 * refuses a submission after the deadline plus a short grace (network lag,
 * a slow tab), and only then may the waiting player claim the match. Both
 * rooms count down from the same stamp, so both players see the same clock.
 */
export const PVP_TURN_SECONDS = 300;
/** Lag allowance before the server treats the turn as over. Not shown as time to use. */
export const PVP_TURN_GRACE_SECONDS = 15;
/** Under this, the clock reads as urgent. */
export const PVP_TURN_WARNING_SECONDS = 30;

function startMs(turnStartedAt: string | null | undefined): number | null {
  if (!turnStartedAt) return null;
  const ms = Date.parse(turnStartedAt);
  return Number.isNaN(ms) ? null : ms;
}

/** Milliseconds left on the visible clock (never negative); null when the turn has no stamp. */
export function turnMsLeft(turnStartedAt: string | null | undefined, nowMs: number): number | null {
  const start = startMs(turnStartedAt);
  if (start === null) return null;
  return Math.max(0, start + PVP_TURN_SECONDS * 1000 - nowMs);
}

/** True once the deadline AND the grace have passed: the server's view of "this turn is over". */
export function turnExpired(turnStartedAt: string | null | undefined, nowMs: number): boolean {
  const start = startMs(turnStartedAt);
  if (start === null) return false;
  return nowMs > start + (PVP_TURN_SECONDS + PVP_TURN_GRACE_SECONDS) * 1000;
}

/** "4:05", "0:09". Rounds up so the clock never shows 0:00 while time remains. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Plain-language length of the clock, for copy ("5 minutes"). */
export function clockLengthLabel(): string {
  const minutes = PVP_TURN_SECONDS / 60;
  return Number.isInteger(minutes) ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${PVP_TURN_SECONDS} seconds`;
}
