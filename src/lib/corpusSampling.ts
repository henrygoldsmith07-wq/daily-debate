// Coverage-aware corpus sampling — which item a rater should see next.
//
// The goal is coverage: push every item to 2+ ratings (Stage 1 bar), then 3+
// (Stage 2/3 bar), fastest. So the sampler prioritises items with the FEWEST
// existing ratings, breaks ties deterministically (oldest first), and still
// excludes the rater's own items and items they already rated. Position-bias
// presentation randomisation is unchanged and unaffected. Pure.

export interface SampleCandidate {
  id: string;
  createdAt: string;
  ratingCount: number;
  contributorId?: string | null;
}

export interface SamplingOptions {
  /** Items this rater already rated — never shown again. */
  ratedIds: ReadonlySet<string>;
  /** The rater's own contributed items — never shown to them. */
  raterId: string;
}

/**
 * Order candidates by coverage need: fewest ratings first, then oldest.
 * Returns only items the rater is eligible to rate.
 */
export function orderForCoverage(
  candidates: SampleCandidate[],
  opts: SamplingOptions,
): SampleCandidate[] {
  return candidates
    .filter((c) => !opts.ratedIds.has(c.id))
    .filter((c) => c.contributorId !== opts.raterId)
    .sort((a, b) => a.ratingCount - b.ratingCount || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}

/** The single next item for this rater, or null when nothing is eligible. */
export function nextItemFor(
  candidates: SampleCandidate[],
  opts: SamplingOptions,
): SampleCandidate | null {
  return orderForCoverage(candidates, opts)[0] ?? null;
}

/**
 * Coverage snapshot for the rater UI: how many items sit at each rating depth.
 * Neutral ("this debate has 1 of 3 ratings"), never a hint at other raters'
 * verdicts.
 */
export function coverageCounts(
  candidates: SampleCandidate[],
  bars: number[] = [2, 3],
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const bar of bars) {
    out[bar] = candidates.filter((c) => c.ratingCount >= bar).length;
  }
  return out;
}
