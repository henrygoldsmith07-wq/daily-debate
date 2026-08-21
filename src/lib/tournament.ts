// Tournament infrastructure — single + double elimination, gated behind Elo reliability.
// Pure, offline-testable. Real scheduling lives in API routes; this is the bracket math.

export type TournamentFormat = "single_elim" | "double_elim" | "round_robin";
export type TournamentStatus = "draft" | "open" | "active" | "completed";

export interface TournamentSeed {
  userId: string;
  rating: number;
  seed: number; // 1 = top
}

export interface TournamentMatch {
  id: string;
  round: number; // 1 = first round
  bracket: "winners" | "losers" | "final";
  playerA: string | null;
  playerB: string | null;
  winnerId: string | null;
  status: "pending" | "active" | "completed";
}

export interface Tournament {
  id: string;
  title: string;
  format: TournamentFormat;
  status: TournamentStatus;
  seeds: TournamentSeed[];
  matches: TournamentMatch[];
  winnerId: string | null;
  seasonId?: string;
  createdAt: string;
}

export function seedPlayers(players: Array<{ userId: string; rating: number }>): TournamentSeed[] {
  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  return sorted.map((p, i) => ({ userId: p.userId, rating: p.rating, seed: i + 1 }));
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function buildSingleElim(seeds: TournamentSeed[], idPrefix = "m"): TournamentMatch[] {
  if (seeds.length < 2) return [];
  const n = nextPow2(seeds.length);
  const byes = n - seeds.length;
  // Simple seeding: 1 vs n, 2 vs n-1 etc. Byes go to top seeds.
  const slots: Array<string | null> = Array(n).fill(null);
  for (let i = 0; i < seeds.length; i++) slots[i] = seeds[i].userId;
  // Shuffle to standard bracket order (bit-reversal for fairness) — simplified: top half vs bottom half
  const matches: TournamentMatch[] = [];
  let round = 1;
  const roundSize = n / 2;
  for (let i = 0; i < roundSize; i++) {
    const a = slots[i] ?? null;
    const b = slots[n - 1 - i] ?? null;
    // If one side is null (bye), that match is auto-completed for the present player
    const hasBye = (a === null) !== (b === null);
    matches.push({
      id: `${idPrefix}-r${round}-${i + 1}`,
      round,
      bracket: "winners",
      playerA: a,
      playerB: b,
      winnerId: hasBye ? (a ?? b) : null,
      status: hasBye ? "completed" : "pending",
    });
  }
  // Future rounds are placeholders (winner TBD)
  let remaining = roundSize / 2;
  let r = 2;
  while (remaining >= 1) {
    for (let i = 0; i < remaining; i++) {
      matches.push({
        id: `${idPrefix}-r${r}-${i + 1}`,
        round: r,
        bracket: "winners",
        playerA: null,
        playerB: null,
        winnerId: null,
        status: "pending",
      });
    }
    remaining /= 2;
    r++;
    if (r > 10) break;
  }
  return matches;
}

export function canStartTournament(seeds: TournamentSeed[], minPlayers = 4): { ok: boolean; reason?: string } {
  if (seeds.length < minPlayers) return { ok: false, reason: `Need at least ${minPlayers} players (have ${seeds.length})` };
  // Power-of-two check: byes are allowed, so any >= minPlayers is ok
  return { ok: true };
}

export function advanceWinners(tournament: Tournament, results: Array<{ matchId: string; winnerId: string }>): Tournament {
  const byId = new Map(tournament.matches.map((m) => [m.id, m]));
  for (const r of results) {
    const m = byId.get(r.matchId);
    if (m) {
      m.winnerId = r.winnerId;
      m.status = "completed";
    }
  }
  // Propagate winners to next round (simple linear fill)
  const rounds = [...new Set(tournament.matches.map((m) => m.round))].sort((a, b) => a - b);
  for (let ri = 0; ri < rounds.length - 1; ri++) {
    const curRound = rounds[ri];
    const nextRound = rounds[ri + 1];
    const cur = tournament.matches.filter((m) => m.round === curRound && m.status === "completed").map((m) => m.winnerId).filter(Boolean) as string[];
    const nextMatches = tournament.matches.filter((m) => m.round === nextRound);
    let idx = 0;
    for (const nm of nextMatches) {
      if (!nm.playerA && idx < cur.length) nm.playerA = cur[idx++];
      if (!nm.playerB && idx < cur.length) nm.playerB = cur[idx++];
      if (nm.playerA && nm.playerB) nm.status = "pending";
    }
  }
  const finalRound = Math.max(...rounds);
  const finals = tournament.matches.filter((m) => m.round === finalRound && m.status === "completed");
  const winnerId = finals.length === 1 ? finals[0].winnerId : null;
  return { ...tournament, matches: [...byId.values()], winnerId, status: winnerId ? "completed" : tournament.status };
}

// Seasonal rankings — only meaningful when participation supports it
export interface SeasonalEntry { userId: string; rating: number; games: number; rd?: number; }
export function seasonalLeaderboard(entries: SeasonalEntry[], minGames = 5): SeasonalEntry[] {
  const qualified = entries.filter((e) => e.games >= minGames);
  if (qualified.length < 8) return []; // not enough participation — don't publish a sparse board
  // Provisional players (rd high or games < 20) sort after established at same rating
  return [...qualified].sort((a, b) => {
    if (a.rating !== b.rating) return b.rating - a.rating;
    const aProv = (a.rd ?? 350) > 150 || a.games < 20;
    const bProv = (b.rd ?? 350) > 150 || b.games < 20;
    if (aProv !== bProv) return aProv ? 1 : -1;
    return 0;
  });
}

export function isSeasonalLeaderboardProvisional(entries: SeasonalEntry[]): boolean {
  const qualified = entries.filter((e) => e.games >= 5);
  return qualified.length < 8 || qualified.some((e) => e.games < 20);
}

export function seasonIdFor(date = new Date()): string {
  // e.g. 2026-S1 (Jan-Jun) / 2026-S2 (Jul-Dec)
  const y = date.getFullYear();
  const half = date.getMonth() < 6 ? "S1" : "S2";
  return `${y}-${half}`;
}
