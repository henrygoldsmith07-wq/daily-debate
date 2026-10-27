import "server-only";

import { queryRows } from "@/lib/backend/sql";
import type { DebateSide } from "@/lib/types";

/**
 * Explore: finished debates their participants chose to publish (migration
 * 042), newest first, each with a crowd vote on which side ARGUED BETTER.
 *
 * A solo debate's two sides are the learner and the AI opponent; a PvP
 * match's are its two players. Both read as For | Against so one card fits
 * both. Vote totals go only to a viewer who has voted or took part, so the
 * split cannot herd a vote before it is cast.
 */
export type ExploreKind = "solo" | "pvp";

export interface ExploreSide {
  name: string;
  /** True for the AI opponent in a solo debate. */
  ai: boolean;
  excerpt: string | null;
}

export interface ExploreVotes {
  for: number;
  against: number;
}

export interface ExploreItem {
  kind: ExploreKind;
  id: string;
  topicTitle: string;
  publishedAt: string;
  for: ExploreSide;
  against: ExploreSide;
  /** Null until the viewer has voted or when they took part. */
  votes: ExploreVotes | null;
  myVote: DebateSide | null;
  isParticipant: boolean;
}

export interface ExploreTurn {
  side: DebateSide;
  speaker: string;
  round: number;
  text: string;
}

export interface ExploreDebate extends ExploreItem {
  turns: ExploreTurn[];
}

export const AI_OPPONENT_NAME = "AI opponent";
const FALLBACK_NAME = "A debater";
const EXCERPT_CHARS = 220;

function excerpt(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > EXCERPT_CHARS ? `${clean.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : clean;
}

function opposite(side: DebateSide): DebateSide {
  return side === "for" ? "against" : "for";
}

interface SoloRow {
  id: string;
  user_id: string;
  side: DebateSide;
  title: string;
  published_at: string;
  username: string | null;
  first_user: string | null;
  first_ai: string | null;
}

interface PvpRow {
  id: string;
  player_a: string;
  player_b: string;
  player_a_side: DebateSide;
  title: string;
  published_at: string;
  a_name: string | null;
  b_name: string | null;
  first_a: string | null;
  first_b: string | null;
}

const SOLO_SELECT = `
  SELECT d.id, d.user_id, d.side, t.title, d.published_at::text AS published_at, p.username,
    (SELECT user_message FROM solo_debate_turns s WHERE s.debate_id = d.id AND s.user_message IS NOT NULL ORDER BY round_number LIMIT 1) AS first_user,
    (SELECT ai_message FROM solo_debate_turns s WHERE s.debate_id = d.id ORDER BY round_number LIMIT 1) AS first_ai
  FROM solo_debates d
  JOIN daily_topics t ON t.id = d.topic_id
  LEFT JOIN profiles p ON p.id = d.user_id
  WHERE d.status = 'completed' AND d.published_at IS NOT NULL`;

const PVP_SELECT = `
  SELECT m.id, m.player_a, m.player_b, m.player_a_side, t.title, m.completed_at::text AS published_at,
    pa.username AS a_name, pb.username AS b_name,
    (SELECT message FROM pvp_turns x WHERE x.match_id = m.id AND x.player_id = m.player_a ORDER BY round_number LIMIT 1) AS first_a,
    (SELECT message FROM pvp_turns x WHERE x.match_id = m.id AND x.player_id = m.player_b ORDER BY round_number LIMIT 1) AS first_b
  FROM pvp_matches m
  JOIN daily_topics t ON t.id = m.topic_id
  LEFT JOIN profiles pa ON pa.id = m.player_a
  LEFT JOIN profiles pb ON pb.id = m.player_b
  WHERE m.status = 'completed' AND m.player_a_publish IS TRUE AND m.player_b_publish IS TRUE`;

function soloItem(row: SoloRow, viewer: string | null): Omit<ExploreItem, "votes" | "myVote"> {
  const learner: ExploreSide = { name: row.username || FALLBACK_NAME, ai: false, excerpt: excerpt(row.first_user) };
  const ai: ExploreSide = { name: AI_OPPONENT_NAME, ai: true, excerpt: excerpt(row.first_ai) };
  return {
    kind: "solo",
    id: row.id,
    topicTitle: row.title,
    publishedAt: row.published_at,
    for: row.side === "for" ? learner : ai,
    against: row.side === "for" ? ai : learner,
    isParticipant: viewer === row.user_id,
  };
}

function pvpItem(row: PvpRow, viewer: string | null): Omit<ExploreItem, "votes" | "myVote"> {
  const a: ExploreSide = { name: row.a_name || FALLBACK_NAME, ai: false, excerpt: excerpt(row.first_a) };
  const b: ExploreSide = { name: row.b_name || FALLBACK_NAME, ai: false, excerpt: excerpt(row.first_b) };
  return {
    kind: "pvp",
    id: row.id,
    topicTitle: row.title,
    publishedAt: row.published_at,
    for: row.player_a_side === "for" ? a : b,
    against: row.player_a_side === "for" ? b : a,
    isParticipant: viewer === row.player_a || viewer === row.player_b,
  };
}

async function attachVotes(items: Omit<ExploreItem, "votes" | "myVote">[], viewer: string | null): Promise<ExploreItem[]> {
  if (items.length === 0) return [];
  const soloIds = items.filter((i) => i.kind === "solo").map((i) => i.id);
  const pvpIds = items.filter((i) => i.kind === "pvp").map((i) => i.id);
  const tallies = await queryRows<{ target: string; choice: DebateSide; n: number | string; mine: boolean }>(
    `SELECT COALESCE(solo_debate_id, pvp_match_id)::text AS target, choice, count(*) AS n,
            bool_or(voter_id = $3::uuid) AS mine
       FROM debate_votes
      WHERE solo_debate_id = ANY($1::uuid[]) OR pvp_match_id = ANY($2::uuid[])
      GROUP BY 1, 2`,
    [soloIds, pvpIds, viewer],
  );
  return items.map((item) => {
    const rows = tallies.filter((t) => t.target === item.id);
    const votes: ExploreVotes = { for: 0, against: 0 };
    let myVote: DebateSide | null = null;
    for (const row of rows) {
      votes[row.choice] = Number(row.n);
      if (row.mine) myVote = row.choice;
    }
    const visible = myVote !== null || item.isParticipant;
    return { ...item, votes: visible ? votes : null, myVote };
  });
}

export async function listExplore(viewer: string | null, limit = 20): Promise<ExploreItem[]> {
  const bounded = Math.max(1, Math.min(50, Math.floor(limit)));
  const [solo, pvp] = await Promise.all([
    queryRows<SoloRow>(`${SOLO_SELECT} ORDER BY d.published_at DESC LIMIT $1`, [bounded]),
    queryRows<PvpRow>(`${PVP_SELECT} ORDER BY m.completed_at DESC LIMIT $1`, [bounded]),
  ]);
  const merged = [...solo.map((r) => soloItem(r, viewer)), ...pvp.map((r) => pvpItem(r, viewer))]
    .sort((x, y) => (x.publishedAt < y.publishedAt ? 1 : x.publishedAt > y.publishedAt ? -1 : 0))
    .slice(0, bounded);
  return attachVotes(merged, viewer);
}

export async function getExploreDebate(viewer: string | null, kind: ExploreKind, id: string): Promise<ExploreDebate | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (kind === "solo") {
    const [row] = await queryRows<SoloRow>(`${SOLO_SELECT} AND d.id = $1`, [id]);
    if (!row) return null;
    const [item] = await attachVotes([soloItem(row, viewer)], viewer);
    const turns = await queryRows<{ round_number: number; ai_message: string | null; user_message: string | null }>(
      "SELECT round_number, ai_message, user_message FROM solo_debate_turns WHERE debate_id = $1 ORDER BY round_number",
      [id],
    );
    const learnerName = row.side === "for" ? item.for.name : item.against.name;
    return {
      ...item,
      turns: turns.flatMap((t) => [
        ...(t.ai_message ? [{ side: opposite(row.side), speaker: AI_OPPONENT_NAME, round: t.round_number, text: t.ai_message }] : []),
        ...(t.user_message ? [{ side: row.side, speaker: learnerName, round: t.round_number, text: t.user_message }] : []),
      ]),
    };
  }
  const [row] = await queryRows<PvpRow>(`${PVP_SELECT} AND m.id = $1`, [id]);
  if (!row) return null;
  const [item] = await attachVotes([pvpItem(row, viewer)], viewer);
  const turns = await queryRows<{ round_number: number; player_id: string; message: string }>(
    "SELECT round_number, player_id, message FROM pvp_turns WHERE match_id = $1 ORDER BY round_number, created_at",
    [id],
  );
  const bSide = opposite(row.player_a_side);
  return {
    ...item,
    turns: turns.map((t) => {
      const isA = t.player_id === row.player_a;
      const side = isA ? row.player_a_side : bSide;
      return { side, speaker: side === "for" ? item.for.name : item.against.name, round: t.round_number, text: t.message };
    }),
  };
}

export type VoteOutcome = "recorded" | "already_voted" | "not_public" | "own_debate";

export async function castVote(voter: string, kind: ExploreKind, id: string, choice: DebateSide): Promise<VoteOutcome> {
  const [row] = await queryRows<{ outcome: VoteOutcome }>("SELECT cast_debate_vote($1, $2, $3, $4) AS outcome", [voter, kind, id, choice]);
  return row?.outcome ?? "not_public";
}

/** Publish or withdraw a finished solo debate. Returns false when it is not the owner's finished debate. */
export async function setSoloPublished(owner: string, debateId: string, publish: boolean): Promise<boolean> {
  const rows = await queryRows<{ id: string }>(
    `UPDATE solo_debates
        SET published_at = CASE WHEN $3 THEN COALESCE(published_at, now()) ELSE NULL END
      WHERE id = $1 AND user_id = $2 AND status = 'completed'
      RETURNING id`,
    [debateId, owner, publish],
  );
  return rows.length === 1;
}

/** Record one player's yes/no on publishing a finished match. Both must say yes. */
export async function setPvpPublished(
  player: string,
  matchId: string,
  publish: boolean,
): Promise<{ mine: boolean; theirs: boolean | null } | null> {
  const rows = await queryRows<{ player_a: string; player_a_publish: boolean | null; player_b_publish: boolean | null }>(
    `UPDATE pvp_matches
        SET player_a_publish = CASE WHEN player_a = $2 THEN $3 ELSE player_a_publish END,
            player_b_publish = CASE WHEN player_b = $2 THEN $3 ELSE player_b_publish END
      WHERE id = $1 AND status = 'completed' AND (player_a = $2 OR player_b = $2)
      RETURNING player_a, player_a_publish, player_b_publish`,
    [matchId, player, publish],
  );
  const row = rows[0];
  if (!row) return null;
  const isA = row.player_a === player;
  return { mine: publish, theirs: isA ? row.player_b_publish : row.player_a_publish };
}
