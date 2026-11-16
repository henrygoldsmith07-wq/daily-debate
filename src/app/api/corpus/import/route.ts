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

  const pendingSolo = (soloDebates ?? []).filter((d) => !importedKeys.has(`solo:${d.id}`));
  const pendingPvp = (pvpMatches ?? []).filter((m) => !importedKeys.has(`pvp:${m.id}`));
  const topicIds = [...new Set([...pendingSolo, ...pendingPvp].map((x) => x.topic_id).filter((x): x is string => !!x))];
  const profileIds = [...new Set([...pendingSolo.map((d) => d.user_id), ...pendingPvp.map((m) => m.player_a)])];

  // Batch the three relations once. The old per-row Promise.all issued up to
  // ~1,600 round-trips for a full 200+200 import. The write stays per-row and
  // conflict-tolerant: that is the concurrency boundary (migration 053).
  const [soloTurnRows, pvpTurnRows, profileRows, topicRows] = await Promise.all([
    pendingSolo.length
      ? service.from("solo_debate_turns").select("debate_id, round_number, ai_message, user_message").in("debate_id", pendingSolo.map((d) => d.id)).order("debate_id").order("round_number")
      : Promise.resolve({ data: [] }),
    pendingPvp.length
      ? service.from("pvp_turns").select("match_id, round_number, player_id, message").in("match_id", pendingPvp.map((m) => m.id)).order("match_id").order("round_number").order("created_at")
      : Promise.resolve({ data: [] }),
    profileIds.length
      ? service.from("profiles").select("id, level").in("id", profileIds)
      : Promise.resolve({ data: [] }),
    topicIds.length
      ? service.from("daily_topics").select("id, category, title, prompt").in("id", topicIds)
      : Promise.resolve({ data: [] }),
  ]);

  type SoloTurn = { round_number: number; ai_message: string; user_message: string | null };
  type PvpTurn = { round_number: number; player_id: string; message: string };
  const soloTurns = new Map<string, SoloTurn[]>();
  for (const t of (soloTurnRows.data ?? []) as Array<SoloTurn & { debate_id: string }>) {
    const rows = soloTurns.get(t.debate_id) ?? [];
    rows.push(t);
    soloTurns.set(t.debate_id, rows);
  }
  const pvpTurns = new Map<string, PvpTurn[]>();
  for (const t of (pvpTurnRows.data ?? []) as Array<PvpTurn & { match_id: string }>) {
    const rows = pvpTurns.get(t.match_id) ?? [];
    rows.push(t);
    pvpTurns.set(t.match_id, rows);
  }
  const profiles = new Map((profileRows.data ?? []).map((p) => [p.id, p]));
  const topics = new Map((topicRows.data ?? []).map((t) => [t.id, t]));

  let imported = 0;
  const errors: string[] = [];

  for (const debate of pendingSolo) {
    try {
      const turns = soloTurns.get(debate.id) ?? [];
      const profile = profiles.get(debate.user_id);
      const topic = topics.get(debate.topic_id);
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
      // The importedKeys snapshot above is a fast path, not a lock. The unique
      // (source_type, source_id) index (migration 053) decides concurrent
      // double-imports: only the request that actually inserts a row counts it.
      const { data: inserted, error } = await service
        .from("corpus_items")
        .insertIgnore({
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
        }, { onConflict: "source_type,source_id" })
        .select("id")
        .maybeSingle();
      if (error) errors.push(`solo ${debate.id}: ${error.message}`);
      else if (inserted) imported += 1; // a concurrent import won: do not double-count
    } catch (e) {
      errors.push(`solo ${debate.id}: ${String(e)}`);
    }
  }

  for (const match of pendingPvp) {
    try {
      const turns = pvpTurns.get(match.id) ?? [];
      const profileA = profiles.get(match.player_a);
      const topic = topics.get(match.topic_id);
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
      const { data: inserted, error } = await service
        .from("corpus_items")
        .insertIgnore({
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
        }, { onConflict: "source_type,source_id" })
        .select("id")
        .maybeSingle();
      if (error) errors.push(`pvp ${match.id}: ${error.message}`);
      else if (inserted) imported += 1;
    } catch (e) {
      errors.push(`pvp ${match.id}: ${String(e)}`);
    }
  }

  if (imported > 0) invalidatePublicCorpusMetrics();

  return NextResponse.json({ imported, errors: errors.slice(0, 20) }, { headers: { "Cache-Control": "no-store" } });
}
