import type { RepairKind, RepairTarget } from "./argumentRepair";

/** 0 = no help, 1 = hint, 2 = worked example, 3 = model rewrite. */
export type HelpLevel = 0 | 1 | 2 | 3;
export const MAX_HELP_LEVEL: HelpLevel = 3;

export const HELP_LEVEL_LABELS: Record<HelpLevel, string> = {
  0: "No help",
  1: "Hint",
  2: "Worked example",
  3: "Model rewrite",
};

/**
 * Help unlocks only after failed attempts: attempt n (n failed so far) may
 * reveal up to level n, capped at 3. Never before the learner has tried.
 */
export function maxUnlockedLevel(failedAttempts: number): HelpLevel {
  if (!Number.isFinite(failedAttempts) || failedAttempts <= 0) return 0;
  return Math.min(Math.floor(failedAttempts), MAX_HELP_LEVEL) as HelpLevel;
}

export function clampHelpLevel(requested: unknown, failedAttempts: number): HelpLevel {
  const n = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : 0;
  return Math.max(0, Math.min(n, maxUnlockedLevel(failedAttempts))) as HelpLevel;
}

const HINTS: Record<RepairKind, string> = {
  evidence: "Name a specific source, number or date that supports the claim, not just that evidence exists.",
  rebuttal: "Quote the opponent's point, then say exactly why it fails or matters less.",
  logic: "Spell out the step from your reason to your conclusion with 'because' or 'which means'.",
  impact: "Say who is affected and why that outweighs the other side's concern.",
  structure: "Lead with the claim, then one reason, then one piece of support.",
  clarity: "Cut it to one claim in one sentence, then add a single reason.",
};

const EXAMPLES: Record<RepairKind, string> = {
  evidence:
    "Weak: 'Studies show remote work helps.' Stronger: 'A 2023 Stanford field study of 1,600 staff found 13% higher output at home.'",
  rebuttal:
    "Weak: 'That's wrong.' Stronger: 'You say costs fall, but that assumes no retraining; once retraining is counted the saving disappears.'",
  logic:
    "Weak: 'Cars are bad, so ban them.' Stronger: 'Cars cause most urban air pollution, which means fewer cars lowers asthma rates, so limits are justified.'",
  impact:
    "Weak: 'This is important.' Stronger: 'It affects 2 million renters, and losing a home outweighs a small tax rise.'",
  structure:
    "Claim: schools should start later. Reason: teens sleep less. Support: a named sleep study.",
  clarity:
    "Weak: 'There are lots of things about it.' Stronger: 'Later start times improve attendance.'",
};

export interface HelpContent {
  level: HelpLevel;
  label: string;
  text: string;
}

/** Deterministic help text for a level. Level 3 builds from the learner's own line, never invents facts. */
export function helpFor(target: Pick<RepairTarget, "kind" | "sourceText">, level: HelpLevel): HelpContent | null {
  if (level <= 0) return null;
  let text: string;
  if (level === 1) text = HINTS[target.kind];
  else if (level === 2) text = EXAMPLES[target.kind];
  else {
    const quote = target.sourceText.trim().slice(0, 240);
    text = `Model shape for "${quote}": ${HINTS[target.kind]} Keep your own claim, add your own specifics, and end on why it matters. Write it in your own words so the retest measures you.`;
  }
  return { level, label: HELP_LEVEL_LABELS[level], text };
}

export interface AttemptRecord {
  helpLevel: HelpLevel;
  demonstrated: boolean;
}

export interface HelpLevelStat {
  level: HelpLevel;
  label: string;
  attempts: number;
  demonstrated: number;
  rate: number | null;
  /** Rates under 10 attempts are not reported. */
  state: "insufficient_evidence" | "unvalidated";
}

export const HELP_STAT_MIN_ATTEMPTS = 10;

export function statsByHelpLevel(attempts: AttemptRecord[]): HelpLevelStat[] {
  return ([0, 1, 2, 3] as HelpLevel[]).map((level) => {
    const rows = attempts.filter((a) => a.helpLevel === level);
    const ok = rows.filter((a) => a.demonstrated).length;
    const enough = rows.length >= HELP_STAT_MIN_ATTEMPTS;
    return {
      level,
      label: HELP_LEVEL_LABELS[level],
      attempts: rows.length,
      demonstrated: ok,
      rate: enough ? ok / rows.length : null,
      state: enough ? "unvalidated" : "insufficient_evidence",
    };
  });
}
