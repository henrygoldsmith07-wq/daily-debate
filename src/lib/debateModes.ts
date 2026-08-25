// Debate mode configuration — four modes that change timing rules, UI hints,
// and what the skill ledger tracks. Pure config + validation.

export type DebateModeId = "text" | "speech" | "rapid-rebuttal" | "prepared-speech";

export interface DebateModeConfig {
  id: DebateModeId;
  label: string;
  description: string;
  /** Whether voice input is the expected input method (text always allowed) */
  voiceExpected: boolean;
  /** Soft time target in seconds (null = no target) */
  softTimeTargetSecs: number | null;
  /** Hard time limit in seconds (null = no limit) */
  hardTimeLimitSecs: number | null;
  /** Minimum word count hint */
  minWordsHint: number;
  /** Maximum word count hint */
  maxWordsHint: number;
  /** UI badge colour token */
  accent: string;
}

export const DEBATE_MODES: Record<DebateModeId, DebateModeConfig> = {
  text: {
    id: "text",
    label: "Text",
    description: "Analytical argument construction — take your time to structure and cite.",
    voiceExpected: false,
    softTimeTargetSecs: null,
    hardTimeLimitSecs: null,
    minWordsHint: 20,
    maxWordsHint: 400,
    accent: "var(--accent)",
  },
  speech: {
    id: "speech",
    label: "Speech",
    description: "Actual debating practice — speak your response aloud for pace and filler analysis.",
    voiceExpected: true,
    softTimeTargetSecs: 60,
    hardTimeLimitSecs: 180,
    minWordsHint: 40,
    maxWordsHint: 350,
    accent: "#7c6ee4",
  },
  "rapid-rebuttal": {
    id: "rapid-rebuttal",
    label: "Rapid Rebuttal",
    description: "30–60 seconds to answer an argument. Trains immediacy and concision.",
    voiceExpected: true,
    softTimeTargetSecs: 45,
    hardTimeLimitSecs: 60,
    minWordsHint: 20,
    maxWordsHint: 150,
    accent: "#e4716e",
  },
  "prepared-speech": {
    id: "prepared-speech",
    label: "Prepared Speech",
    description: "2–5 minute structured case with signposting. Trains extended argument construction.",
    voiceExpected: true,
    softTimeTargetSecs: 180,
    hardTimeLimitSecs: 300,
    minWordsHint: 150,
    maxWordsHint: 800,
    accent: "#5ea86e",
  },
};

export const DEBATE_MODE_LIST = Object.values(DEBATE_MODES);

/** Validate a mode id string against known modes; returns default on mismatch. */
export function resolveMode(id: string | undefined | null): DebateModeConfig {
  if (id && id in DEBATE_MODES) return DEBATE_MODES[id as DebateModeId];
  return DEBATE_MODES.text;
}

/**
 * Check whether a turn meets the mode's constraints.
 * Returns warnings (not errors) — the debate isn't blocked, just flagged.
 */
export function checkModeConstraints(
  mode: DebateModeConfig,
  wordCount: number,
  durationSeconds: number | null
): string[] {
  const warnings: string[] = [];
  if (mode.hardTimeLimitSecs !== null && durationSeconds !== null && durationSeconds > mode.hardTimeLimitSecs) {
    warnings.push(`Exceeded ${mode.label} time limit (${mode.hardTimeLimitSecs}s).`);
  }
  if (wordCount < mode.minWordsHint) {
    warnings.push(`Short for ${mode.label} mode — aim for ${mode.minWordsHint}+ words.`);
  }
  if (wordCount > mode.maxWordsHint) {
    warnings.push(`Long for ${mode.label} mode — aim for ≤${mode.maxWordsHint} words.`);
  }
  if (mode.voiceExpected && durationSeconds === null) {
    warnings.push(`${mode.label} mode works best with voice input for pace and filler tracking.`);
  }
  return warnings;
}
