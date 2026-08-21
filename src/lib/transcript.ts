// Replayable transcripts & async debates.
// A transcript is just ordered turns; "async" means turns are not required to be live — the opponent has hours.
import type { PvpTurn } from "./types";

export interface AsyncPolicy { maxHoursPerTurn: number; totalDays: number; }
export const DEFAULT_ASYNC: AsyncPolicy = { maxHoursPerTurn: 24, totalDays: 7 };

export function isOverdue(lastTurnAt: string, nowIso: string, hours: number): boolean {
  const diff = new Date(nowIso).getTime() - new Date(lastTurnAt).getTime();
  return diff > hours * 3600 * 1000;
}

export function transcriptForReplay(turns: PvpTurn[]): Array<{ round: number; playerId: string; message: string }> {
  return [...turns].sort((a,b)=> a.round_number - b.round_number).map((t)=> ({ round: t.round_number, playerId: t.player_id, message: t.message }));
}

export function transcriptText(turns: PvpTurn[], aName="Player A", bName="Player B"): string {
  return transcriptForReplay(turns).map((t)=> `${t.playerId===aName? aName: bName} (round ${t.round}): ${t.message}`).join("\n");
}
