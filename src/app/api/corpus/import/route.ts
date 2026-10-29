import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  abilityBandFor,
  anonymiseTranscript,
  deriveDynamicsTier,
  deriveEvidenceDensity,
  deriveStyleBucket,
  lengthBucketFor,
  oppositeStance,
} from "@/lib/corpus";
import { assessArgumentGraph, mergeAssessmentGraphs, graphFromTurn } from "@/lib/observableAssessment";
import { styleFeatures } from "@/lib/debateEvaluation";
import { getRequestAuthContext } from "@/lib/requestAuth";
import { invalidatePublicCorpusMetrics } from "@/lib/publicCorpusMetrics";

// Admin-only: import finished debates into the blind-rating corpus.
// Anonymisation happens HERE — raters never see contributor identity,
// player names, or which side was the AI.

// Deterministic stratification from the observable argument assessment — no
// model judgement involved, so strata labels are reproducible.
function deriveStrataFromRounds(rounds: Array<{ round: number; user: string; opponent: string }>) {
  const graphs = rounds
    .filter((r) => r.user.trim())
    .map((r) => graphFromTurn({ userMessage: r.user, opponentMessage: r.opponent, round: r.round }));
  if (!graphs.length) return null;
  const merged = mergeAssessmentGraphs(graphs);
  const assessment = assessArgumentGraph(merged, {
    sideA: "a",
    sideB: "b",
    extractionSource: "deterministic",
    labelA: "Side A",
    labelB: "Side B",
  });
  const scoreA = assessment.scores.a ?? 0;
  const scoreB = assessment.scores.b ?? 0;
  const claims = merged.nodes.filter((n) => n.kind === "claim" || n.kind === "counterclaim").length;
  const fullText = rounds.map((r) => `${r.user} ${r.opponent}`).join(" ");
  const style = styleFeatures(fullText);
  return {
    dynamics_tier: deriveDynamicsTier(scoreA, scoreB),
    evidence_density: deriveEvidenceDensity(merged.evidenceStats.total, claims),
    style_bucket: deriveStyleBucket({
      formality: style.formalConnectorsPer100,
      hedges: style.hedgesPer100,
      assertives: style.assertivesPer100,
    }),
  };
}

/**
 * Batched contributor-level lookup. Semantics match the previous per-debate
 * `.single()` reads exactly: a missing profile yields `null` (abilityBandFor
 * maps null to the default band), and only a genuine query failure throws —
 * which the import loop already reports as a per-debate error.
 */
async function lookupContributorLevels(
  service: ReturnType<typeof createServiceClient>,
  ids: string[],
): Promise<Map<string, { level: number }>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data, error } = await service.from("profiles").select("id, level").in("id", unique);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.id, { level: row.level }]));
}

/** Batched topic lookup with the same missing-row semantics as `.single()`. */
async function lookupTopics(
  service: ReturnType<typeof createServiceClient>,
  ids: string[],
): Promise<Map<string, { category: string | null; title: string; prompt: string }>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data, error } = await service.from("daily_topics").select("id, category, title, prompt").in("id", unique);
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? []).map((row) => [row.id, { category: row.category, title: row.title, prompt: row.prompt }]),
  );
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "corpus-import", limit: 6, windowMs: 60 * 60_000 });
  if (limited) return limited;

  const auth = await getRequestAuthContext();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createServiceClient();

  // Completed solo debates not yet imported.
  const { data: soloDebates } = await service
    .from("solo_debates")
    .select("id, user_id, topic_id, side, status")
    .eq("status", "completed")
    .limit(200);
  const { data: pvpMatches } = await service
    .from("pvp_matches")
    .select("id, player_a, player_b, player_a_side, topic_id, status")
    .eq("status", "completed")
    .limit(200);

  const { data: alreadyImported } = await service.from("corpus_items").select("source_type, source_id");
  const importedKeys = new Set((alreadyImported ?? []).map((r) => `${r.source_type}:${r.source_id}`));

  // Contributor levels and topics are looked up per debate; without batching
  // they add two extra queries per debate (up to ~800 round trips for a
  // 400-debate import, all sequential inside the import loop). One `in` query
  // per table per source type keeps the loop to its one genuinely per-debate
  // read — the turns.
  const [soloLevels, soloTopics, pvpLevels, pvpTopics] = await Promise.all([
    lookupContributorLevels(service, (soloDebates ?? []).map((d) => d.user_id)),
    lookupTopics(service, (soloDebates ?? []).map((d) => d.topic_id)),
    lookupContributorLevels(service, (pvpMatches ?? []).map((m) => m.player_a)),
    lookupTopics(service, (pvpMatches ?? []).map((m) => m.topic_id)),
  ]);

  let imported = 0;
  const errors: string[] = [];

  for (const debate of soloDebates ?? []) {
    if (importedKeys.has(`solo:${debate.id}`)) continue;
    try {
      const [{ data: turns }, { data: profile }, { data: topic }] = await Promise.all([
        service.from("solo_debate_turns").select("round_number, ai_message, user_message").eq("debate_id", debate.id).order("round_number"),
        Promise.resolve({ data: soloLevels.get(debate.user_id) ?? null, error: null }),
        Promise.resolve({ data: soloTopics.get(debate.topic_id) ?? null, error: null }),
      ]);
      const lines: Array<{ side: "a" | "b"; round: number; text: string }> = [];
      for (const t of turns ?? []) {
        if (t.user_message) lines.push({ side: "a", round: t.round_number, text: t.user_message });
        lines.push({ side: "b", round: t.round_number, text: t.ai_message });
      }
      if (lines.length < 4) continue; // too thin to rate meaningfully
      const transcript = anonymiseTranscript(lines);
      const rounds = (turns ?? [])
        .filter((t) => t.user_message)
        .map((t) => ({ round: t.round_number, user: t.user_message as string, opponent: t.ai_message }));
      const strata = deriveStrataFromRounds(rounds) ?? {};
      const { error } = await service.from("corpus_items").insert({
        transcript,
        topic: topic?.category ?? null,
        source_type: "solo",
        source_id: debate.id,
        contributor_id: debate.user_id,
        // Stances let the system-comparison step re-judge the real motion.
        side_mapping: {
          a: "user",
          b: "ai",
          a_stance: debate.side,
          b_stance: oppositeStance(debate.side as "for" | "against"),
        },
        length_bucket: lengthBucketFor(transcript),
        subject_category: topic?.category ?? null,
        ability_band: abilityBandFor(profile?.level),
        topic_id: debate.topic_id,
        topic_title: topic?.title ?? "",
        topic_prompt: topic?.prompt ?? "",
        ...strata,
      });
      if (error) errors.push(`solo ${debate.id}: ${error.message}`);
      else imported += 1;
    } catch (e) {
      errors.push(`solo ${debate.id}: ${String(e)}`);
    }
  }

  for (const match of pvpMatches ?? []) {
    if (importedKeys.has(`pvp:${match.id}`)) continue;
    try {
      const [{ data: turns }, { data: profileA }, { data: topic }] = await Promise.all([
        service.from("pvp_turns").select("round_number, player_id, message").eq("match_id", match.id).order("round_number").order("created_at"),
        Promise.resolve({ data: pvpLevels.get(match.player_a) ?? null, error: null }),
        Promise.resolve({ data: pvpTopics.get(match.topic_id) ?? null, error: null }),
      ]);
      const lines: Array<{ side: "a" | "b"; round: number; text: string }> = [];
      for (const t of turns ?? []) {
        lines.push({ side: t.player_id === match.player_a ? "a" : "b", round: t.round_number, text: t.message });
      }
      if (lines.length < 4) continue;
      const transcript = anonymiseTranscript(lines);
      // PvP alternates players per round; treat player A as the round's
      // "user" and player B as its opponent for stratification purposes.
      const byRound = new Map<number, { user: string; opponent: string }>();
      for (const t of turns ?? []) {
        const entry = byRound.get(t.round_number) ?? { user: "", opponent: "" };
        if (t.player_id === match.player_a) entry.user = t.message;
        else entry.opponent = t.message;
        byRound.set(t.round_number, entry);
      }
      const rounds = [...byRound.entries()].map(([round, r]) => ({ round, ...r }));
      const strata = deriveStrataFromRounds(rounds) ?? {};
      // Contributor of record is player A; both are excluded from rating it.
      const { error } = await service.from("corpus_items").insert({
        transcript,
        topic: topic?.category ?? null,
        source_type: "pvp",
        source_id: match.id,
        contributor_id: match.player_a,
        side_mapping: {
          contributors: [match.player_a, match.player_b],
          a_stance: match.player_a_side,
          b_stance: oppositeStance(match.player_a_side as "for" | "against"),
        },
        length_bucket: lengthBucketFor(transcript),
        subject_category: topic?.category ?? null,
        ability_band: abilityBandFor(profileA?.level),
        topic_id: match.topic_id,
        topic_title: topic?.title ?? "",
        topic_prompt: topic?.prompt ?? "",
        ...strata,
      });
      if (error) errors.push(`pvp ${match.id}: ${error.message}`);
      else imported += 1;
    } catch (e) {
      errors.push(`pvp ${match.id}: ${String(e)}`);
    }
  }

  if (imported > 0) invalidatePublicCorpusMetrics();

  return NextResponse.json({ imported, errors: errors.slice(0, 20) });
}
