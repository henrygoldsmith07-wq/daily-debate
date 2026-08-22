import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/database.types";
import type { TurnScores } from "./types";

export interface FactorRatings extends TurnScores {
  roundsScored: number;
}

const FACTORS: (keyof TurnScores)[] = ["depth", "evidence", "logic", "rebuttal", "clarity"];

// Averages the five observable-feature projections across a user's scored
// solo-debate turns, giving a profile rather than a single point total.
// Deliberately windowed to RECENT debates: an all-time average dilutes signal
// as the debater improves, while the last few sessions show current form.
const RECENT_DEBATE_WINDOW = 10;

export async function getFactorRatings(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<FactorRatings | null> {
  const { data: debates } = await supabase
    .from("solo_debates")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(RECENT_DEBATE_WINDOW);
  const debateIds = (debates ?? []).map((d) => d.id);
  if (debateIds.length === 0) return null;

  const { data: turns } = await supabase
    .from("solo_debate_turns")
    .select("scores")
    .in("debate_id", debateIds)
    .not("scores", "is", null);

  const scored = (turns ?? [])
    .map((t) => t.scores as TurnScores | null)
    .filter((s): s is TurnScores => s !== null);
  if (scored.length === 0) return null;

  const totals = FACTORS.reduce((acc, factor) => {
    acc[factor] = scored.reduce((sum, s) => sum + s[factor], 0) / scored.length;
    return acc;
  }, {} as TurnScores);

  return { ...totals, roundsScored: scored.length };
}

