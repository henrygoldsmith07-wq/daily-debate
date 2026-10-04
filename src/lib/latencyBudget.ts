// Turn-latency budgets: the product SLO for the model layer.
//
// Every model call this app makes is on a user's critical path. A Daily Sprint
// is ~4 minutes across three rounds, and each round is a sequential chain:
// structure classification -> opponent generation -> argument extraction ->
// evaluation. The provider chain (NVIDIA -> OpenRouter -> UnoRouter -> Kirai)
// can walk all four before a turn resolves, and the live benchmark records a
// p50 of ~15.6s for the slowest of them. Nothing in the product stated what a
// turn is allowed to cost, so nobody could tell a slow provider from a broken
// one until a user complained.
//
// This module declares those budgets and assesses them against the measured
// p95 that aiOps already computes. It is pure; the admin loader supplies rows.
//
// The honesty rules are the project's existing ones:
//   - a budget is never met by a sample too small to judge: below
//     MIN_BUDGET_SAMPLE calls the state is `insufficient-data`, not `ok`;
//   - an operation absent from the ledger is `unmeasured`, never assumed
//     healthy;
//   - the degraded behaviour is stated per budget, because what the user sees
//     when a budget is missed is the product decision that matters.

import type { AiOpsStats } from "./aiOps";

export interface LatencyBudget {
  operation: string;
  label: string;
  /** p95 target in milliseconds. */
  budgetMs: number;
  /** Why this number, stated so it can be argued with rather than inherited. */
  rationale: string;
  /** What the user actually experiences when this budget is missed. */
  degradedBehaviour: string;
}

/**
 * Declared budgets, on p95 of the calls actually observed.
 *
 * Where `docs/operations.md` already states a product budget, that number is
 * carried here unchanged — these are the documented targets, now measured
 * rather than aspirational. Two of them were unreachable on the free provider
 * chain when this was written; that is reported as a breach, not resolved by
 * quietly raising the target.
 */
export const LATENCY_BUDGETS: LatencyBudget[] = [
  {
    operation: "classify_argument_structure",
    label: "Structure classification",
    budgetMs: 3_000,
    rationale:
      "Batched per turn against classifier.dev. It runs inline on the submit path, so every second here is a second added to every round; the code already degrades to the local path above this.",
    degradedBehaviour:
      "Falls back to deterministic local classification and keeps the ensemble path open. The turn continues; routing hints are less specific.",
  },
  {
    operation: "debate_opening",
    label: "Opponent opening",
    budgetMs: 6_000,
    rationale:
      "A single blocking model call before the learner sees a board. Same 6s wall target as a turn: nothing about opening is cheaper, and it is the one place a long wait is hardest to excuse.",
    degradedBehaviour:
      "Start is claim-first and atomic, so a timed-out opening leaves no half-started debate. The learner retries; the stale claim self-heals.",
  },
  {
    operation: "debate_turn",
    label: "Opponent turn",
    budgetMs: 6_000,
    rationale:
      "The documented product budget (docs/operations.md): p95 <= 6s wall, model-bound. `useResponseWindow` runs a server-authoritative clock over the turn, so a slow turn does not merely annoy — it consumes the window the learner is being timed against. On the current free chain (live benchmark p50 ~15.6s for the slowest provider) this budget is NOT met; that is reported as a breach, not resolved by moving the target.",
    degradedBehaviour:
      "Fails over through the provider chain. When the chain is exhausted the response is not persisted and the turn stays open — the learner keeps their text and can resubmit.",
  },
  {
    operation: "summarize_solo",
    label: "Solo result summary",
    budgetMs: 8_000,
    rationale:
      "The documented 'Finish debate' budget: p95 <= 8s wall for summary plus assessment. Runs after the final round, off the typing path but still inside the result screen the learner waits on.",
    degradedBehaviour:
      "The deterministic parts of the result (argument graph, observable features, evidence verification) are already computed, so the screen still renders; the summary degrades rather than blocking.",
  },
  {
    operation: "judge_pvp",
    label: "PvP verdict",
    budgetMs: 30_000,
    rationale:
      "An ensemble call, so it legitimately costs more than a single turn; bounded by the ensemble's own timeout rather than by a learner waiting on it.",
    degradedBehaviour:
      "Returns an explicit `insufficient_evidence` verdict rather than a forced call. Until the judge passes validation this is the default state anyway.",
  },
  {
    operation: "generate_daily_topic",
    label: "Daily topic generation",
    budgetMs: 20_000,
    rationale:
      "Scheduled, not on any user request path. The budget exists so provider latency regressions are visible; missing it degrades to curated fallbacks rather than breaking the day.",
    degradedBehaviour:
      "The app serves curated fallback motions. The pipeline failing is degraded, not broken, until the 03:00 UTC availability deadline passes.",
  },
];

/** Minimum calls before a p95 is reported at all. Mirrors AI_OPS_MIN_SAMPLE. */
export const MIN_BUDGET_SAMPLE = 5;

export type BudgetState = "ok" | "over-budget" | "insufficient-data" | "unmeasured";

export interface BudgetAssessment {
  operation: string;
  label: string;
  budgetMs: number;
  /** Measured p95, or null when the sample is too small to state one. */
  measuredP95Ms: number | null;
  state: BudgetState;
  calls: number;
  /** What the user experiences when this budget is missed. */
  degradedBehaviour: string;
  note: string | null;
}

export interface LatencyBudgetReport {
  generatedAt: string;
  assessments: BudgetAssessment[];
  overBudget: number;
  insufficientData: number;
  unmeasured: number;
  note: string | null;
}

function ms(n: number | null): string {
  return n === null ? "—" : `${Math.round(n)}ms`;
}

/**
 * Assess every declared budget against measured stats.
 *
 * `stats` is whatever aiOps produced; an operation with no row is `unmeasured`
 * rather than silently absent, so a budget that stopped being exercised is
 * visible instead of disappearing from the report.
 */
export function assessLatencyBudgets(input: {
  stats: AiOpsStats[];
  generatedAt: string;
  budgets?: LatencyBudget[];
}): LatencyBudgetReport {
  const budgets = input.budgets ?? LATENCY_BUDGETS;
  const byOperation = new Map(input.stats.map((s) => [s.operation, s]));

  const assessments: BudgetAssessment[] = budgets.map((b) => {
    const s = byOperation.get(b.operation);
    if (!s) {
      return {
        operation: b.operation,
        label: b.label,
        budgetMs: b.budgetMs,
        measuredP95Ms: null,
        state: "unmeasured",
        calls: 0,
        degradedBehaviour: b.degradedBehaviour,
        note: "No calls recorded for this operation in the window. Absence of calls is not evidence of speed.",
      };
    }
    if (s.calls < MIN_BUDGET_SAMPLE || s.p95LatencyMs === null) {
      return {
        operation: b.operation,
        label: b.label,
        budgetMs: b.budgetMs,
        measuredP95Ms: null,
        state: "insufficient-data",
        calls: s.calls,
        degradedBehaviour: b.degradedBehaviour,
        note: `Only ${s.calls} call(s) in the window; a p95 needs at least ${MIN_BUDGET_SAMPLE}. Not judged either way.`,
      };
    }
    const over = s.p95LatencyMs > b.budgetMs;
    return {
      operation: b.operation,
      label: b.label,
      budgetMs: b.budgetMs,
      measuredP95Ms: s.p95LatencyMs,
      state: over ? "over-budget" : "ok",
      calls: s.calls,
      degradedBehaviour: b.degradedBehaviour,
      note: `p95 ${ms(s.p95LatencyMs)} against a ${b.budgetMs}ms budget over ${s.calls} calls.`,
    };
  });

  const overBudget = assessments.filter((a) => a.state === "over-budget").length;
  const insufficientData = assessments.filter((a) => a.state === "insufficient-data").length;
  const unmeasured = assessments.filter((a) => a.state === "unmeasured").length;

  return {
    generatedAt: input.generatedAt,
    assessments,
    overBudget,
    insufficientData,
    unmeasured,
    note:
      assessments.length === 0
        ? "No budgets declared."
        : overBudget > 0
          ? `${overBudget} of ${assessments.length} model operations are over their p95 budget. These are provider-latency regressions, not judge-quality findings — the two are measured separately.`
          : insufficientData + unmeasured > 0
            ? `No budget is currently breached, but ${insufficientData + unmeasured} of ${assessments.length} operations lack enough calls to judge. Absence of calls is not evidence of speed.`
            : `All ${assessments.length} model operations are within their p95 budgets.`,
  };
}