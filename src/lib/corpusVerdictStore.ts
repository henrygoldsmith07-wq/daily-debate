import "server-only";

import { randomUUID } from "node:crypto";
import { queryRows } from "@/lib/backend/sql";
import type { WinnerLabel } from "@/lib/humanCorpus";

export async function writeCorpusAdjudication(input: {
  corpusId: string;
  winner: WinnerLabel;
  basis: string;
  actor: string;
  at: string;
  minimumRatings: number;
}): Promise<boolean> {
  const rows = await queryRows<{ id: string }>(
    `
    UPDATE corpus_items
    SET status = 'adjudicated',
        side_mapping = (
          coalesce(side_mapping, '{}'::jsonb)
          - 'adjudication_stale'
          - 'adjudication_stale_at'
          - 'adjudication_stale_actor'
        ) || jsonb_build_object(
          'consensus_winner', $2::text,
          'basis', $3::text,
          'adjudicated_by', $4::text,
          'adjudicated_at', $5::text
        )
    WHERE id = $1
      AND status IN ('rated', 'adjudicated')
      AND rating_count >= $6
      AND (SELECT count(*) FROM corpus_ratings cr WHERE cr.corpus_id = corpus_items.id) >= $6
    RETURNING id
    `,
    [input.corpusId, input.winner, input.basis, input.actor, input.at, input.minimumRatings],
  );
  return rows.length === 1;
}

export interface SystemJudgeClaim {
  token: string;
}

/** Claim one corpus item before making an external model call. Stale claims recover automatically. */
export async function claimCorpusSystemJudge(corpusId: string): Promise<SystemJudgeClaim | null> {
  const token = randomUUID();
  const rows = await queryRows<{ claim_token: string }>(
    `
    INSERT INTO corpus_system_judge_claims (corpus_id, claim_token, claimed_at)
    SELECT ci.id, $2::uuid, now()
    FROM corpus_items ci
    WHERE ci.id = $1
      AND ci.status IN ('rated', 'adjudicated')
      AND NOT (coalesce(ci.side_mapping, '{}'::jsonb) ? 'system_verdict')
    ON CONFLICT (corpus_id) DO UPDATE
      SET claim_token = excluded.claim_token,
          claimed_at = excluded.claimed_at
      WHERE corpus_system_judge_claims.claimed_at < now() - interval '20 minutes'
    RETURNING claim_token::text
    `,
    [corpusId, token],
  );
  return rows[0] ? { token: rows[0].claim_token } : null;
}

export async function releaseCorpusSystemJudgeClaim(corpusId: string, token: string): Promise<void> {
  await queryRows(
    "DELETE FROM corpus_system_judge_claims WHERE corpus_id = $1 AND claim_token = $2::uuid RETURNING corpus_id",
    [corpusId, token],
  );
}

/** Persist only if this worker still owns the claim; updates one JSON key atomically. */
export async function persistCorpusSystemVerdict(
  corpusId: string,
  token: string,
  verdict: Record<string, unknown>,
): Promise<boolean> {
  const rows = await queryRows<{ id: string }>(
    `
    WITH owned_claim AS (
      DELETE FROM corpus_system_judge_claims
      WHERE corpus_id = $1 AND claim_token = $2::uuid
      RETURNING corpus_id
    )
    UPDATE corpus_items ci
    SET side_mapping = jsonb_set(
      coalesce(ci.side_mapping, '{}'::jsonb),
      '{system_verdict}',
      $3::jsonb,
      true
    )
    FROM owned_claim c
    WHERE ci.id = c.corpus_id
      AND NOT (coalesce(ci.side_mapping, '{}'::jsonb) ? 'system_verdict')
    RETURNING ci.id
    `,
    [corpusId, token, JSON.stringify(verdict)],
  );
  return rows.length === 1;
}
