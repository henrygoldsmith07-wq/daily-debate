// Political identifier — a picture of the positions you've taken.
//
// This is deliberately framed as a pattern of choices, never as a measure of
// belief, personality, or validated political science. The copy below only
// describes which way arguments were made, and how often. Pure, no side
// effects: the server loader in politicalIdentifierServer.ts feeds it rows.

export type StancePosition = "for" | "against";

export interface StanceRecord {
  category: string | null;
  position: StancePosition;
  at?: string;
}

export interface CategoryStance {
  key: string;
  label: string;
  forCount: number;
  againstCount: number;
  total: number;
  forShare: number;
}

export type StanceLean = "for" | "against" | "mixed";

export interface PoliticalIdentifierModel {
  state: "ok" | "insufficient_evidence";
  total: number;
  needed: number;
  lean: StanceLean | null;
  forShare: number | null;
  categories: CategoryStance[];
  verdict: string | null;
  note: string;
}

export const POLITICAL_ID_MIN_POSITIONS = 8;

/**
 * The honest caveat travels with every read, including the empty one. It says
 * what the identifier is (a pattern of choices) and what it is not (a measure
 * of belief or a validated political score).
 */
const IDENTIFIER_NOTE =
  "This reflects a pattern of the positions you've taken, not a measure of your beliefs. It is descriptive, not a validated political score.";

function share(part: number, whole: number): number {
  return Math.round((part / whole) * 100);
}

function leanFor(forShare: number): StanceLean {
  if (forShare >= 60) return "for";
  if (forShare <= 40) return "against";
  return "mixed";
}

function baseVerdict(lean: StanceLean): string {
  // "For" means for a motion's proposition, not for change — many motions are
  // preservational. Keep the product's neutral side vocabulary here.
  if (lean === "for") return "You argued For more often than Against.";
  if (lean === "against") return "You argued Against more often than For.";
  return "You argued For and Against about evenly — no clear tilt in the positions you've taken.";
}

/** Local guard for untrusted input (DB rows, JSON). Mirrors isMotionPosition. */
export function isStancePosition(value: unknown): value is StancePosition {
  return value === "for" || value === "against";
}

/**
 * Build the identifier from the learner's recorded positions. Below the
 * minimum we say nothing about lean or categories — a handful of stances is
 * noise, and naming a pattern from it would be a claim we cannot support.
 */
export function buildPoliticalIdentifier(rows: readonly StanceRecord[]): PoliticalIdentifierModel {
  const total = rows.length;

  if (total < POLITICAL_ID_MIN_POSITIONS) {
    return {
      state: "insufficient_evidence",
      total,
      needed: POLITICAL_ID_MIN_POSITIONS,
      lean: null,
      forShare: null,
      categories: [],
      verdict: null,
      note: IDENTIFIER_NOTE,
    };
  }

  let forCount = 0;
  const byKey = new Map<string, { label: string; forCount: number; againstCount: number }>();

  for (const row of rows) {
    if (row.position === "for") forCount += 1;

    const trimmed = (row.category ?? "").trim();
    const key = trimmed === "" ? "other" : trimmed.toLowerCase();
    let bucket = byKey.get(key);
    if (!bucket) {
      // Human label comes from the first non-empty category value we saw for
      // this key; the "other" bucket is named explicitly.
      bucket = { label: key === "other" ? "Other" : trimmed, forCount: 0, againstCount: 0 };
      byKey.set(key, bucket);
    }
    if (row.position === "for") bucket.forCount += 1;
    else bucket.againstCount += 1;
  }

  const forShare = share(forCount, total);
  const lean = leanFor(forShare);

  const categories: CategoryStance[] = Array.from(byKey.entries())
    .map(([key, bucket]) => {
      const categoryTotal = bucket.forCount + bucket.againstCount;
      return {
        key,
        label: bucket.label,
        forCount: bucket.forCount,
        againstCount: bucket.againstCount,
        total: categoryTotal,
        forShare: share(bucket.forCount, categoryTotal),
      };
    })
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

  // Name the busiest topic as a VOLUME fact only. The old "Most clearly on X"
  // implied the lean was strongest there, but the busiest category can be the
  // one argued the other way. Require at least two positions so a single
  // stray stance never earns a "most active" call-out.
  const dominant = categories[0];
  const verdict = dominant && dominant.total >= 2
    ? `${baseVerdict(lean)} Your most active topic was ${dominant.label.toLowerCase()}.`
    : baseVerdict(lean);

  return {
    state: "ok",
    total,
    needed: POLITICAL_ID_MIN_POSITIONS,
    lean,
    forShare,
    categories,
    verdict,
    note: IDENTIFIER_NOTE,
  };
}
