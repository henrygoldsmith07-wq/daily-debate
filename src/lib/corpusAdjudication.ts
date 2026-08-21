// Corpus adjudication: rater guidance, consensus labels, and resolving
// disagreements between independent raters. Pure — operates on the
// `humanCorpus` shapes and keeps the agreement math there focused on
// reliability statistics. This is the human-in-the-loop layer the roadmap's
// "rater guidance / human consensus labels / adjudicated disagreements"
// items map to.

import type { LabeledDebate, RaterVerdict, WinnerLabel } from "./humanCorpus";

/** The rubric every rater sees before labelling a debate. */
export const RATER_GUIDANCE = `Rate the debate, not your position. A side wins when it:
1. grounds claims with named, real institutions (root homepages only),
2. rebuts the opponent's specific points rather than restating its own,
3. weighs impacts with a reason (cost vs reliability vs rights), and
4. avoids fallacies and dropped threads.
Label "a", "b", or "tie" — use "tie" only when both sides are genuinely even.`;

export interface Consensus {
  winner: WinnerLabel;
  votes: Record<WinnerLabel, number>;
  unanimous: boolean;
  /** margin between the top label and the runner-up (0 on a split). */
  margin: number;
}

/** Majority vote over raters. A top-label tie resolves to "tie" (too close to call). */
export function consensusLabel(verdicts: RaterVerdict[]): Consensus {
  const votes: Record<WinnerLabel, number> = { a: 0, b: 0, tie: 0 };
  for (const v of verdicts) votes[v.winner] = (votes[v.winner] ?? 0) + 1;
  const order: WinnerLabel[] = ["a", "b", "tie"];
  const sorted = [...order].sort((x, y) => votes[y] - votes[x]);
  const top = sorted[0];
  const runnerUp = sorted[1];
  const winner: WinnerLabel = votes[top] === votes[runnerUp] ? "tie" : top;
  const unanimous = verdicts.length > 1 && votes[top] === verdicts.length;
  return { winner, votes, unanimous, margin: votes[top] - votes[runnerUp] };
}

/** A debate needs adjudication when ≥2 raters disagree on the winner. */
export function adjudicationNeeded(debate: LabeledDebate): boolean {
  const verdicts = debate.raterVerdicts ?? [];
  if (verdicts.length < 2) return false;
  return !consensusLabel(verdicts).unanimous;
}

/** Record a human adjudicator's resolution, overwriting the consensus label. */
export function adjudicateDebate(
  debate: LabeledDebate,
  adjudicatorId: string,
  winner: WinnerLabel,
  note: string,
): LabeledDebate {
  if (!note?.trim()) throw new Error("adjudication note required — state which raters were overruled and why");
  return {
    ...debate,
    humanWinner: winner,
    adjudicated: true,
    adjudicatedBy: adjudicatorId,
    adjudicationNote: note,
  };
}

export interface CorpusConsensus {
  n: number;
  unanimousCount: number;
  adjudicatedCount: number;
  /** Share of debates whose raters already agree (no adjudication needed). */
  consensusRate: number;
  /** Debates still needing adjudication. */
  pending: LabeledDebate[];
}

/** Aggregate consensus quality across a corpus. */
export function corpusConsensus(corpus: LabeledDebate[]): CorpusConsensus {
  let unanimousCount = 0;
  let adjudicatedCount = 0;
  const pending: LabeledDebate[] = [];
  for (const d of corpus) {
    if (d.adjudicated) {
      adjudicatedCount++;
      continue;
    }
    if (adjudicationNeeded(d)) pending.push(d);
    else if ((d.raterVerdicts ?? []).length >= 2) unanimousCount++;
  }
  const n = corpus.length;
  return {
    n,
    unanimousCount,
    adjudicatedCount,
    consensusRate: n ? unanimousCount / n : 0,
    pending,
  };
}
