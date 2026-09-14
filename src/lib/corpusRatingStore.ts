// Immutable corpus-rating storage. Ratings are append-once: (corpus_id,
// rater_id) is unique and a second submission is REJECTED, never overwritten.
// Corrections go through a separate admin path that preserves the original
// values in an audit trail (see appendRatingCorrection).
//
// The insert and the item-closure flip run in ONE statement with a row lock
// (SELECT ... FOR UPDATE on the item), so:
//   - two simultaneous final raters serialise: both ratings land (both were
//     legitimately submitted while the item was open), then the first flip
//     closes the item;
//   - a submission arriving AFTER closure finds status <> 'open' under the
//     lock and is rejected at insert time — no TOCTOU window;
//   - duplicate submissions are no-ops via ON CONFLICT DO NOTHING, reported
//     back so the route can answer 409 instead of silently overwriting.

import "server-only";
import { queryRows } from "./backend/sql";

export type RatingInsertOutcome =
  | { result: "accepted"; flippedToRated: boolean }
  | { result: "duplicate" }
  | { result: "item-closed"; status: string | null }
  | { result: "item-missing" };

export interface ImmutableRating {
  corpusId: string;
  raterId: string;
  scoresA: Record<string, number>;
  scoresB: Record<string, number>;
  winner: string;
  confidence: number | null;
  rationale: string;
  presentedFirst: string;
}

export async function insertImmutableRating(
  rating: ImmutableRating,
  minRaters: number,
): Promise<RatingInsertOutcome> {
  const flags = await queryRows<{ inserted: number; flipped: number }>(
    `
    WITH guard AS (
      SELECT id FROM corpus_items
      WHERE id = $1 AND status = 'open'
      FOR UPDATE
    ), ins AS (
      INSERT INTO corpus_ratings (
        corpus_id, rater_id, scores_a, scores_b, winner, confidence, rationale, presented_first
      )
      SELECT $1, $2, $3::jsonb, $4::jsonb, $5, $6::numeric, $7, $8 FROM guard
      ON CONFLICT (corpus_id, rater_id) DO NOTHING
      RETURNING id
    ), flip AS (
      UPDATE corpus_items SET status = 'rated'
      WHERE id = $1 AND status = 'open'
        AND (SELECT count(*) FROM corpus_ratings WHERE corpus_id = $1) >= $9
      RETURNING id
    )
    SELECT (SELECT count(*) FROM ins) AS inserted, (SELECT count(*) FROM flip) AS flipped
    `,
    [
      rating.corpusId,
      rating.raterId,
      JSON.stringify(rating.scoresA),
      JSON.stringify(rating.scoresB),
      rating.winner,
      rating.confidence,
      rating.rationale,
      rating.presentedFirst,
      minRaters,
    ],
  );
  const inserted = Number(flags[0]?.inserted ?? 0) > 0;

  if (inserted) {
    return { result: "accepted", flippedToRated: Number(flags[0]?.flipped ?? 0) > 0 };
  }

  // Not accepted: duplicate or closed/missing. Distinguish with one read.
  const [existing] = await queryRows<{ id: unknown }>(
    "SELECT id FROM corpus_ratings WHERE corpus_id = $1 AND rater_id = $2",
    [rating.corpusId, rating.raterId],
  );
  if (existing) return { result: "duplicate" };
  const [item] = await queryRows<{ status: string | null }>(
    "SELECT status FROM corpus_items WHERE id = $1",
    [rating.corpusId],
  );
  if (!item) return { result: "item-missing" };
  return { result: "item-closed", status: item.status };
}

export interface CorrectionEntry {
  at: string;
  actor: string;
  reason: string;
  previous: { winner: unknown; scoresA: unknown; scoresB: unknown };
}

/**
 * Admin correction: overwrite the verdict while appending an immutable audit
 * entry. All SET expressions read the OLD row, so `previous` captures the
 * value before THIS correction, and the whole update is atomic.
 */
export async function appendRatingCorrection(input: {
  corpusId: string;
  raterId: string;
  winner: string;
  scoresA: Record<string, number>;
  scoresB: Record<string, number>;
  actor: string;
  reason: string;
  at: string;
}): Promise<{ applied: boolean; corrections: CorrectionEntry[] | null }> {
  const rows = await queryRows<{ id: string; corrections: CorrectionEntry[] }>(
    `
    UPDATE corpus_ratings
    SET corrections = corrections || jsonb_build_array(jsonb_build_object(
          'at', $3, 'actor', $4, 'reason', $5,
          'previous', jsonb_build_object('winner', winner, 'scoresA', scores_a, 'scoresB', scores_b)
        )),
        winner = $6,
        scores_a = $7::jsonb,
        scores_b = $8::jsonb
    WHERE corpus_id = $1 AND rater_id = $2
    RETURNING id, corrections
    `,
    [
      input.corpusId,
      input.raterId,
      input.at,
      input.actor,
      input.reason,
      input.winner,
      JSON.stringify(input.scoresA),
      JSON.stringify(input.scoresB),
    ],
  );
  return { applied: rows.length > 0, corrections: rows[0]?.corrections ?? null };
}
