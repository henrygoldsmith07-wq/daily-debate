// Immutable corpus-rating storage. Ratings are append-once: (corpus_id,
// rater_id) is unique and a second submission is REJECTED, never overwritten.
// Corrections go through a separate admin path that preserves the original
// values in an audit trail (see appendRatingCorrection).
//
// The insert and the item-closure flip run in ONE statement with a row lock
// (SELECT ... FOR UPDATE on the item), so:
//   - two simultaneous final raters serialise: the first closes the item, the
//     second sees status <> 'open' under the lock and is rejected;
//   - a submission arriving AFTER closure finds status <> 'open' at insert
//     time — no TOCTOU window;
//   - duplicate submissions are no-ops via ON CONFLICT DO NOTHING, reported
//     back so the route can answer 409 instead of silently overwriting.
//
// Closure arithmetic (migration 013): a data-modifying CTE cannot observe
// rows concurrent transactions committed after this statement's snapshot
// began, so counting corpus_ratings here would under-close under load.
// Instead the accepted insert increments corpus_items.rating_count inside
// the same UPDATE that may close the item: the row is locked by `guard`, the
// assignment reads the FRESHLY re-fetched row version (READ COMMITTED
// lock-wait semantics), so before + this is exact and the item flips to
// 'rated' immediately when the counter reaches the threshold. Works on both
// SQL transports (no multi-statement transaction needed).

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
  const flags = await queryRows<{ inserted: number; rated_now: boolean }>(
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
    )
    UPDATE corpus_items ci
    SET rating_count = ci.rating_count + accepted.c,
        status = CASE
          WHEN ci.status = 'open' AND ci.rating_count + accepted.c >= $9 THEN 'rated'
          ELSE ci.status
        END
    FROM (SELECT count(*)::int AS c FROM ins) accepted
    WHERE ci.id = $1 AND accepted.c > 0
    RETURNING accepted.c AS inserted, (ci.status = 'rated') AS rated_now
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
    return { result: "accepted", flippedToRated: flags[0].rated_now === true };
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
  before: { winner: unknown; scoresA: unknown; scoresB: unknown };
  after: { winner: unknown; scoresA: unknown; scoresB: unknown };
}

/**
 * Admin correction: overwrite the verdict while appending a SELF-CONTAINED
 * audit event — timestamp, actor, reason, the complete `before` state and
 * the complete `after` state. All SET expressions read the OLD row, so
 * `before` captures the value immediately prior to THIS correction even
 * when corrections stack, and `||` keeps the history append-only.
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
          'at', $3::text, 'actor', $4::text, 'reason', $5::text,
          'before', jsonb_build_object('winner', winner, 'scoresA', scores_a, 'scoresB', scores_b),
          'after', jsonb_build_object('winner', $6::text, 'scoresA', $7::jsonb, 'scoresB', $8::jsonb)
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
