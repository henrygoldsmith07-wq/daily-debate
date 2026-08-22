import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { abilityBandFor, anonymiseTranscript, isCorpusAdmin, lengthBucketFor, oppositeStance } from "@/lib/corpus";

// Admin-only: import finished debates into the blind-rating corpus.
// Anonymisation happens HERE — raters never see contributor identity,
// player names, or which side was the AI.

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
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

  let imported = 0;
  const errors: string[] = [];

  for (const debate of soloDebates ?? []) {
    if (importedKeys.has(`solo:${debate.id}`)) continue;
    try {
      const [{ data: turns }, { data: profile }, { data: topic }] = await Promise.all([
        service.from("solo_debate_turns").select("round_number, ai_message, user_message").eq("debate_id", debate.id).order("round_number"),
        service.from("profiles").select("level").eq("id", debate.user_id).single(),
        service.from("daily_topics").select("category, title, prompt").eq("id", debate.topic_id).single(),
      ]);
      const lines: Array<{ side: "a" | "b"; round: number; text: string }> = [];
      for (const t of turns ?? []) {
        if (t.user_message) lines.push({ side: "a", round: t.round_number, text: t.user_message });
        lines.push({ side: "b", round: t.round_number, text: t.ai_message });
      }
      if (lines.length < 4) continue; // too thin to rate meaningfully
      const transcript = anonymiseTranscript(lines);
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
        service.from("profiles").select("level").eq("id", match.player_a).single(),
        service.from("daily_topics").select("category, title, prompt").eq("id", match.topic_id).single(),
      ]);
      const lines: Array<{ side: "a" | "b"; round: number; text: string }> = [];
      for (const t of turns ?? []) {
        lines.push({ side: t.player_id === match.player_a ? "a" : "b", round: t.round_number, text: t.message });
      }
      if (lines.length < 4) continue;
      const transcript = anonymiseTranscript(lines);
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
      });
      if (error) errors.push(`pvp ${match.id}: ${error.message}`);
      else imported += 1;
    } catch (e) {
      errors.push(`pvp ${match.id}: ${String(e)}`);
    }
  }

  return NextResponse.json({ imported, errors: errors.slice(0, 20) });
}
