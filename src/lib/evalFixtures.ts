// Deterministic offline scaffold for the evaluation pipeline. Feeds
// dailyDebateEvaluation() so the benchmark page can exercise reliability,
// comparison, calibration, and bias detection without network or DB.
// These are regression diagnostics — NOT human-validity evidence.
// Provenance is "synthetic" by construction.

import {
  EVAL_DIMENSIONS,
  type EvalDebate,
  type SystemVerdict,
  type SideScores,
} from "./debateEvaluation";

const SHORT_A = "Solar LCOE beats gas on cost per Lazard.";
const LONG_A =
  "Solar LCOE beats gas on cost per Lazard, and NREL storage data confirms total cost stays lower through 2035 even when grid upgrades are included in the comparison.";
const SHORT_B = "Intermittency requires expensive backup capacity.";
const LONG_B = "Intermittency requires expensive backup capacity, and OECD polling shows publics resist the transmission build-out that full decarbonisation would require.";

function transcriptFor(i: number): string {
  const aText = i % 2 === 0 ? LONG_A : SHORT_A;
  const bText = i % 2 === 0 ? LONG_B : SHORT_B;
  return [
    `Player A (round 1): ${aText}`,
    `Player B (round 1): ${bText}`,
    `Player A (round 2): ${aText}`,
    `Player B (round 2): ${bText}`,
  ].join("\n");
}

const QUALITY_A = [4, 3, 5, 2, 3, 5];
const QUALITY_B = [2, 4, 3, 3, 4, 2];

function uniform(v: number): SideScores {
  const s = {} as SideScores;
  for (const d of EVAL_DIMENSIONS) s[d] = v;
  return s;
}

export function syntheticEvalCorpus(n = 6): EvalDebate[] {
  return Array.from({ length: Math.max(2, n) }, (_, i) => ({
    id: `syn-eval-${String(i + 1).padStart(2, "0")}`,
    transcript: transcriptFor(i),
    topic: "energy",
    provenance: "synthetic" as const,
    raters: [0, 1, 2].map((r) => {
      const aScore = Math.min(5, Math.max(1, QUALITY_A[i % QUALITY_A.length] + (r === 2 && i % 2 === 1 ? -1 : 0)));
      const bScore = Math.min(5, Math.max(1, QUALITY_B[i % QUALITY_B.length] + (r === 1 ? 1 : 0)));
      return { raterId: `r${r + 1}`, a: uniform(aScore), b: uniform(bScore) };
    }),
  }));
}

/**
 * Mock system judge. With `verbosityTilt` the system scores wordy sides
 * higher than humans did — detectVerbosityBias should flag it; without the
 * tilt it tracks human quality and bias probes should stay quiet.
 */
export function systemVerdictsTrackingHumans(corpus: EvalDebate[], verbosityTilt = false): SystemVerdict[] {
  return corpus.map((d) => {
    const aHuman = d.raters.reduce((s, r) => s + meanScore(r.a), 0) / d.raters.length;
    const bHuman = d.raters.reduce((s, r) => s + meanScore(r.b), 0) / d.raters.length;
    const tilt = (side: "A" | "B") =>
      verbosityTilt ? countSideWords(d.transcript, side) / 40 : 0;
    return {
      id: d.id,
      a: uniform(clamp1to5(Math.round((aHuman + tilt("A")) * 10) / 10)),
      b: uniform(clamp1to5(Math.round((bHuman + tilt("B")) * 10) / 10)),
    };
  });
}

function meanScore(s: SideScores): number {
  return EVAL_DIMENSIONS.reduce((acc, dim) => acc + s[dim], 0) / EVAL_DIMENSIONS.length;
}

function clamp1to5(v: number): number {
  return Math.min(5, Math.max(1, v));
}

function countSideWords(transcript: string, side: "A" | "B"): number {
  let words = 0;
  for (const line of transcript.split("\n")) {
    if (line.startsWith(`Player ${side} `)) words += line.split(/\s+/).slice(3).length;
  }
  return words;
}
