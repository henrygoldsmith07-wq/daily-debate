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

export function isDebateModeId(value: unknown): value is DebateModeId {
  return typeof value === "string" && value in DEBATE_MODES;
}

/** Validate a mode id string against known modes; returns default on mismatch. */
export function resolveMode(id: string | undefined | null): DebateModeConfig {
  if (id && id in DEBATE_MODES) return DEBATE_MODES[id as DebateModeId];
  return DEBATE_MODES.text;
}

/** Blocking timing validation used by the turn API for genuinely timed modes. */
export function hardTimeLimitError(mode: DebateModeConfig, elapsedSeconds: number | null): string | null {
  if (mode.hardTimeLimitSecs === null) return null;
  if (elapsedSeconds === null) return `${mode.label} requires an active response timer.`;
  if (elapsedSeconds > mode.hardTimeLimitSecs) {
    return `${mode.label} time limit expired. Restart the mode or choose another mode.`;
  }
  return null;
}

/**
 * Check non-blocking coaching constraints. Hard timing limits are enforced by
 * the turn API before this helper runs; this function still records timing
 * anomalies for legacy/imported rows and analysis.
 */
export function checkModeConstraints(
  mode: DebateModeConfig,
  wordCount: number,
  durationSeconds: number | null,
  inputMode?: "text" | "voice",
): string[] {
  const warnings: string[] = [];
  if (mode.hardTimeLimitSecs !== null && durationSeconds === null) {
    warnings.push(`${mode.label} timing was unavailable for this turn.`);
  }
  if (mode.hardTimeLimitSecs !== null && durationSeconds !== null && durationSeconds > mode.hardTimeLimitSecs) {
    warnings.push(`Exceeded ${mode.label} time limit (${mode.hardTimeLimitSecs}s).`);
  }
  if (wordCount < mode.minWordsHint) {
    warnings.push(`Short for ${mode.label} mode — aim for ${mode.minWordsHint}+ words.`);
  }
  if (wordCount > mode.maxWordsHint) {
    warnings.push(`Long for ${mode.label} mode — aim for ≤${mode.maxWordsHint} words.`);
  }
  if (mode.voiceExpected && inputMode !== "voice") {
    warnings.push(`${mode.label} mode works best with voice input for pace and filler tracking.`);
  }
  return warnings;
}
