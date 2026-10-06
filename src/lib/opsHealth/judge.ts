// Judge validation artifact health.
//
// Reads the weekly judge benchmark artifact: is it recent enough to trust, and
// does it cover enough models/items to say anything?

import type { HealthState } from "./core";

// --- Judge validation -------------------------------------------------------

export interface JudgeArtifactInput {
  at: string;
  limit: number | null;
  allPass: boolean | null;
  models: string[];
  stale?: unknown;
}

export interface JudgeHealth {
  status: HealthState;
  lastRunAt: string | null;
  fixtures: number | null;
  fullPack: boolean | null;
  models: string[];
  allPass: boolean | null;
  ageDays: number | null;
  note: string | null;
}

export const JUDGE_FRESH_DAYS = 14;
export const JUDGE_STALE_DAYS = 30;
export const JUDGE_FULL_PACK = 24;

export function assessJudgeHealth(artifact: JudgeArtifactInput | null, nowIso: string): JudgeHealth {
  if (!artifact) {
    return {
      status: "blocked",
      lastRunAt: null,
      fixtures: null,
      fullPack: null,
      models: [],
      allPass: null,
      ageDays: null,
      note: "No live benchmark artifact on record — judge validation has never completed here.",
    };
  }
  const ageDays = Math.max(
    0,
    Math.floor((Date.parse(nowIso) - Date.parse(artifact.at)) / 86_400_000),
  );
  const fullPack = artifact.limit !== null && artifact.limit >= JUDGE_FULL_PACK;
  const base = {
    lastRunAt: artifact.at,
    fixtures: artifact.limit,
    fullPack,
    models: artifact.models,
    allPass: artifact.allPass,
    ageDays,
  };
  if (artifact.allPass === false) {
    return { ...base, status: "failed", note: "The last live run FAILED its gates — the failure is preserved, not hidden." };
  }
  if (ageDays > JUDGE_STALE_DAYS) {
    return { ...base, status: "stale", note: `Last live validation is ${ageDays} days old — treat judge claims as expired.` };
  }
  if (ageDays > JUDGE_FRESH_DAYS) {
    return { ...base, status: "degraded", note: `Last live validation is ${ageDays} days old — refresh due within ${JUDGE_STALE_DAYS} days.` };
  }
  if (!fullPack) {
    return { ...base, status: "degraded", note: "Last run covered a partial fixture pack — not full validation." };
  }
  return { ...base, status: "healthy", note: null };
}

// --- Database / migrations ---------------------------------------------------
