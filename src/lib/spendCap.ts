// Daily AI spend cap — a durable, fail-open safety net against runaway spend.
//
// The meter is `ai_call_log` for the current UTC day (migrations 006/015/037):
// provider-reported cost is summed verbatim, and calls where the provider
// reports no cost (Anthropic; classifier.dev) are charged a DECLARED
// per-call assumption so the meter can never silently read $0 when cost is
// unreported. The assumption is an explicit, tunable number — a declared
// budgeting figure, not a measured price — and is documented as such.
//
// Behaviour contract:
//  * Cap exceeded  -> SpendCapReachedError. Callers degrade EXPLICITLY
//    (opponent unavailable with the response saved, judge-unavailable with
//    the match left active), never silently.
//  * Meter unreadable -> fail OPEN with a warning. The cap is a runaway
//    safety net, not a money wall: an ai_call_log outage must not take the
//    product down.
//  * Unit tests (NODE_ENV=test) never touch a database unless a meter is
//    injected.
//
// Env:
//  * AI_DAILY_SPEND_CAP_USD   default 10; "off" disables the cap entirely;
//                             0 blocks every paid call (legitimate use: hold
//                             spend at exactly zero).
//  * AI_SPEND_UNCOSTED_CALL_USD  default 0.02; declared charge for each
//                             call whose provider reported no cost.

import "server-only";

export class SpendCapReachedError extends Error {
  readonly code = "spend_cap_reached";
  constructor(message: string) {
    super(message);
    this.name = "SpendCapReachedError";
  }
}

export interface SpendCapConfig {
  /** Daily cap in USD, or null when the cap is disabled. */
  capUsd: number | null;
  /** Declared USD charged for each provider-silent (uncosted) call. */
  uncostedCallUsd: number;
}

const DEFAULT_CAP_USD = 10;
const DEFAULT_UNCOSTED_CALL_USD = 0.02;

export function parseSpendCapConfig(env: Record<string, string | undefined> = process.env): SpendCapConfig {
  const raw = (env.AI_DAILY_SPEND_CAP_USD ?? "").trim();
  let capUsd: number | null = DEFAULT_CAP_USD;
  if (raw) {
    const lower = raw.toLowerCase();
    if (lower === "off" || lower === "disabled" || lower === "0off") {
      capUsd = null;
    } else {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        capUsd = parsed;
      } else {
        console.warn(`[spend-cap] AI_DAILY_SPEND_CAP_USD="${raw}" is not a number or "off"; using default $${DEFAULT_CAP_USD}.`);
      }
    }
  }
  const rawUncosted = (env.AI_SPEND_UNCOSTED_CALL_USD ?? "").trim();
  let uncostedCallUsd = DEFAULT_UNCOSTED_CALL_USD;
  if (rawUncosted) {
    const parsed = Number(rawUncosted);
    if (Number.isFinite(parsed) && parsed >= 0) {
      uncostedCallUsd = parsed;
    } else {
      console.warn(`[spend-cap] AI_SPEND_UNCOSTED_CALL_USD="${rawUncosted}" is not a number; using default $${DEFAULT_UNCOSTED_CALL_USD}.`);
    }
  }
  return { capUsd, uncostedCallUsd };
}

/** Durable meter totals for today (UTC) from ai_call_log. */
export interface SpendMeterTotals {
  reportedUsd: number;
  uncostedCalls: number;
}

export type SpendMeterReader = () => Promise<SpendMeterTotals>;

/** Estimated spend today: reported cost + declared charge for uncosted calls. */
export function estimatedSpendUsd(totals: SpendMeterTotals, uncostedCallUsd: number): number {
  const reported = Number.isFinite(totals.reportedUsd) ? totals.reportedUsd : 0;
  const uncosted = Number.isFinite(totals.uncostedCalls) ? totals.uncostedCalls : 0;
  return reported + uncosted * uncostedCallUsd;
}

/** Seconds until the UTC-day meter resets (bounded below so Retry-After is meaningful). */
export function retryAfterSecondsToReset(now: Date = new Date()): number {
  const nextReset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((nextReset - now.getTime()) / 1000));
}

export function spendCapMessage(spendUsd: number, capUsd: number): string {
  return (
    `Daily AI limit reached: about $${spendUsd.toFixed(2)} of the $${capUsd.toFixed(2)} daily allowance used today (UTC). ` +
    `Try again after the daily reset.`
  );
}

async function defaultMeter(): Promise<SpendMeterTotals> {
  const { queryRows } = await import("./backend/sql");
  const now = new Date();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rows = await queryRows<{ reported: number | string | null; uncosted: number | string | null }>(
    `select coalesce(sum(cost_usd), 0) as reported,
            count(*) filter (where cost_usd is null) as uncosted
       from ai_call_log
      where created_at >= $1
        and event_type = 'model_call'`,
    [new Date(dayStart).toISOString()],
  );
  const row = rows[0];
  return {
    reportedUsd: Number(row?.reported ?? 0),
    uncostedCalls: Number(row?.uncosted ?? 0),
  };
}

/**
 * Throw SpendCapReachedError when today's durable spend is at or over the
 * cap. Resolves (with a warning) when the meter cannot be read.
 */
export async function ensureSpendWithinCap(
  env: Record<string, string | undefined> = process.env,
  readMeter?: SpendMeterReader,
): Promise<void> {
  const { capUsd, uncostedCallUsd } = parseSpendCapConfig(env);
  if (capUsd === null) return;

  let totals: SpendMeterTotals;
  try {
    if (readMeter) {
      totals = await readMeter();
    } else {
      if (env.NODE_ENV === "test") return; // unit tests never touch a database
      totals = await defaultMeter();
    }
  } catch (error) {
    console.warn(
      `[spend-cap] meter unavailable; allowing the call rather than failing the product: ${
        error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
      }`,
    );
    return;
  }

  const spend = estimatedSpendUsd(totals, uncostedCallUsd);
  if (spend >= capUsd) {
    throw new SpendCapReachedError(spendCapMessage(spend, capUsd));
  }
}

export function isSpendCapError(error: unknown): error is SpendCapReachedError {
  return error instanceof SpendCapReachedError || (error as Error | null)?.name === "SpendCapReachedError";
}
