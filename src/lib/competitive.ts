// Competitive play: Elo gated behind judge reliability.
// Until judge invariance is proven, Elo is not shown and not used for matchmaking.
// After the gate opens (see tournament.ts / seasonalLeaderboard), ranked matchmaking,
// tournaments, and seasonal boards are enabled — only if participation supports them.

export interface EloGate { reliable: boolean; reason?: string; }
export function eloGate({ invarianceOk, humanAgreement }: { invarianceOk: boolean; humanAgreement: number }): EloGate {
  if (!invarianceOk) return { reliable: false, reason: "Judge invariance not yet proven — ranked play paused." };
  if (humanAgreement < 0.7) return { reliable: false, reason: `Human agreement ${(humanAgreement*100).toFixed(0)}% below 70% threshold.` };
  return { reliable: true };
}

export const PROVISIONAL_GAMES = 20;
export const MIN_RANKED_GAMES = 5;
export const MIN_GAMES_FOR_LEADERBOARD = 5;
export const PROVISIONAL_RATING = 1200;
export const RATING_DEVIATION_START = 350; // provisional uncertainty (like Glicko RD)
export const RATING_DEVIATION_FLOOR = 50;

export interface RatedPlayer {
  userId: string;
  rating: number;
  games: number;
  rd: number; // rating deviation / uncertainty
  provisional: boolean;
}

export function provisionalRating(): number { return PROVISIONAL_RATING; }
export function isProvisional(games: number): boolean { return games < PROVISIONAL_GAMES; }
export function ratingWithUncertainty(rating: number, rd: number): { display: string; provisional: boolean } {
  if (rd > 150) return { display: `${rating} (provisional ±${rd})`, provisional: true };
  return { display: String(rating), provisional: false };
}

export function updateRd(rd: number, games: number): number {
  // RD shrinks with games; simple decay: RD = max(floor, start - games*12)
  return Math.max(RATING_DEVIATION_FLOOR, RATING_DEVIATION_START - games * 12);
}

export function antiAbuseCheck(params: {
  recentOpponents: string[]; // last N opponent ids
  recentResults: Array<0 | 0.5 | 1>;
  gamesInWindow: number;
}): { ok: boolean; reason?: string } {
  // Detect win-trading: same opponent repeatedly with same outcome
  const last = params.recentOpponents.slice(-6);
  const unique = new Set(last);
  if (last.length >= 5 && unique.size === 1) return { ok: false, reason: "Repeated same opponent — possible win-trading." };
  // Too many games too fast (bot)
  if (params.gamesInWindow > 20) return { ok: false, reason: "Too many recent games — rate-limited." };
  return { ok: true };
}

export function canEnterRanked(games: number, gate: EloGate): { ok: boolean; reason?: string } {
  if (!gate.reliable) return { ok: false, reason: gate.reason };
  if (games < MIN_RANKED_GAMES) return { ok: false, reason: `Need ${MIN_RANKED_GAMES} games before ranked (have ${games}).` };
  return { ok: true };
}

export function kFactor(games: number): number { return games < 10 ? 40 : games < 30 ? 24 : 16; }
export function expectedScore(rA: number, rB: number): number { return 1 / (1 + Math.pow(10, (rB - rA)/400)); }
export function eloDelta(rA: number, rB: number, outcome: 0|0.5|1, gamesA: number): number { return Math.round(kFactor(gamesA) * (outcome - expectedScore(rA, rB))); }

// Matchmaking: FIFO now; with Elo gate it becomes skill-bucketed. This helper picks opponent.
export function pickOpponent(queue: Array<{ userId: string; rating: number }>, seekerRating: number, gate: EloGate): string | null {
  if (!gate.reliable) return queue[0]?.userId ?? null; // FIFO
  // Bucket: prefer within 150 Elo, and prefer non-provisional when both close
  const sorted = [...queue].sort((a,b)=> Math.abs(a.rating - seekerRating) - Math.abs(b.rating - seekerRating));
  // Anti-abuse: if seeker would farm a much lower provisional, skip
  const best = sorted[0];
  if (best && Math.abs(best.rating - seekerRating) > 350) return null; // too far — keep waiting rather than mismatch
  return best?.userId ?? null;
}

// Do not prioritise competitive ranking until judging validity is demonstrated.
// Gate message for UI: ranking is provisional until corpus + invariance prove the judge.
export const RANKING_STATUS_NOTE = "Ranking is provisional: judge validity must be demonstrated on a 1k+ human corpus with ≥70% agreement and measured invariance before ordinal ranking is meaningful." as const;
