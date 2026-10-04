// Validation stage progress — the internal scoreboard for genuine
// human-labelled debate data. Numbers come from real rows only; criteria that
// cannot yet be computed are reported as unknown, never assumed to pass.
//
// Stage thresholds are main's own (corpus.VALIDATION_STAGES): this module
// adds the per-stage progress reading — debates qualifying, ratings collected,
// what is missing — and the Stage 3 strata-balance criterion.
//
//   Stage 1 · pilot     ≥100 debates × ≥2 ratings
//   Stage 2 · calibration ≥500 debates × ≥3 ratings
//   Stage 3 · mature      ≥1,000 debates × ≥3 ratings with balanced strata
//
// "Genuine debates" excludes synthetic items where that metadata exists;
// where it does not, the count is a raw row count and the panel says so.
// Pure.

import {
  CALIBRATION_RATERS_PER_ITEM,
  MIN_RATERS_PER_ITEM,
  STRATUM_MINIMUM,
  VALIDATION_STAGES,
} from "./corpus";

export interface ValidationStageInput {
  /** Item id → rating count (real rows). */
  ratingCounts: Map<string, number>;
  /** Items known to be synthetic (cannot establish human validity). */
  syntheticIds?: Set<string>;
  /** Stratum cell → item count (only when strata metadata exists). */
  strata?: Record<string, number>;
  /** Minimum per-stratum cell for "balanced" — null when not computable. */
  strataMinimum?: number | null;
}

export interface ValidationStage {
  id: 1 | 2 | 3;
  title: string;
  minDebates: number;
  minRatings: number;
  /** Debates that currently meet this stage's per-debate rating bar. */
  debatesQualifying: number;
  /** Total ratings on those debates. */
  ratingsOnQualifying: number;
  /** What is still missing, in one sentence. */
  missing: string;
  achieved: boolean;
  /** Stage 3 only: whether strata balance is computable and met. */
  balancedStrata?: { state: "met" | "not-met" | "not-computable"; detail: string };
}

interface StageSpec {
  id: 1 | 2 | 3;
  title: string;
  minDebates: number;
  minRatings: number;
}

/** Product stage order, sourced from the shared corpus stage definitions. */
const STAGE_SPECS: StageSpec[] = [
  {
    id: 1,
    title: VALIDATION_STAGES.pilot.label,
    minDebates: VALIDATION_STAGES.pilot.minItems,
    minRatings: VALIDATION_STAGES.pilot.minRatersPerItem || MIN_RATERS_PER_ITEM,
  },
  {
    id: 2,
    title: VALIDATION_STAGES.calibration.label,
    minDebates: VALIDATION_STAGES.calibration.minItems,
    minRatings: VALIDATION_STAGES.calibration.minRatersPerItem || CALIBRATION_RATERS_PER_ITEM,
  },
  {
    id: 3,
    title: VALIDATION_STAGES.mature.label,
    minDebates: VALIDATION_STAGES.mature.minItems,
    minRatings: VALIDATION_STAGES.mature.minRatersPerItem || CALIBRATION_RATERS_PER_ITEM,
  },
];

/**
 * Compute the three stages from real rating rows. Every number is a count of
 * what exists; nothing is extrapolated.
 */
export function buildValidationStages(input: ValidationStageInput): ValidationStage[] {
  const { ratingCounts, syntheticIds = new Set(), strata, strataMinimum = STRATUM_MINIMUM } = input;

  return STAGE_SPECS.map((stage) => {
    let debatesQualifying = 0;
    let ratingsOnQualifying = 0;
    for (const [itemId, count] of ratingCounts) {
      if (syntheticIds.has(itemId)) continue;
      if (count >= stage.minRatings) {
        debatesQualifying += 1;
        ratingsOnQualifying += count;
      }
    }

    const debateGap = Math.max(0, stage.minDebates - debatesQualifying);
    const achieved = debatesQualifying >= stage.minDebates;

    let balancedStrata: ValidationStage["balancedStrata"];
    if (stage.id === 3) {
      balancedStrata = strataBalance(strata, strataMinimum);
    }

    const missingParts: string[] = [];
    if (debateGap > 0) {
      missingParts.push(`${debateGap} more ${debateGap === 1 ? "debate" : "debates"} with ≥${stage.minRatings} ratings`);
    }
    if (stage.id === 3 && balancedStrata && balancedStrata.state !== "met") {
      missingParts.push(
        balancedStrata.state === "not-computable"
          ? "strata balance cannot be computed yet (stratum metadata missing)"
          : "strata balance",
      );
    }

    return {
      id: stage.id,
      title: stage.title,
      minDebates: stage.minDebates,
      minRatings: stage.minRatings,
      debatesQualifying,
      ratingsOnQualifying,
      missing: achieved && missingParts.length === 0
        ? "Complete."
        : missingParts.length
          ? `Needs ${missingParts.join(" + ")}.`
          : "Complete.",
      achieved: achieved && (stage.id !== 3 || !balancedStrata || balancedStrata.state === "met"),
      ...(balancedStrata ? { balancedStrata } : {}),
    };
  });
}

/**
 * Stage 3's balance criterion. Strata are "balanced" when every reported
 * cell meets the minimum; with no stratum metadata at all the criterion is
 * NOT COMPUTABLE and must never be reported as met.
 */
function strataBalance(
  strata: Record<string, number> | undefined,
  minimum: number | null,
): { state: "met" | "not-met" | "not-computable"; detail: string } {
  if (!strata || Object.keys(strata).length === 0) {
    return { state: "not-computable", detail: "No stratum metadata on the current items." };
  }
  if (minimum === null) {
    return { state: "not-computable", detail: "Stratum minimum is not defined for this corpus yet." };
  }
  const cells = Object.entries(strata).map(([cell, n]) => ({ cell, n }));
  const under = cells.filter((c) => c.n < minimum);
  if (!under.length) {
    return { state: "met", detail: `All ${cells.length} stratum cells have ≥${minimum} items.` };
  }
  return {
    state: "not-met",
    detail: `${under.length} of ${cells.length} stratum cells are below ${minimum} items (${under.slice(0, 3).map((c) => c.cell).join(", ")}${under.length > 3 ? ", …" : ""}).`,
  };
}
