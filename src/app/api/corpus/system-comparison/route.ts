import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { aggregateSystemComparison, isCorpusAdmin, type ComparisonPair } from "@/lib/corpus";
import { consensusLabel } from "@/lib/corpusAdjudication";
import type { WinnerLabel } from "@/lib/humanCorpus";

interface CorpusItemRow {
  id: string;
  transcript: string;
  side_mapping: unknown;
  topic_title: string;
  topic_prompt: string;
}

interface RatingRow {
  corpus_id: string;
  winner: string;
}

// Admin-only, explicit, costed: runs the live ensemble judge over
// agreement-ready corpus items (humans already agreed) and compares the
// judge's winner against the human consensus. This is the only place where
// system-vs-human accuracy is computed — per the pipeline rule it never runs
// over items where raters disagreed.

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "corpus-syscomp", limit: 4, windowMs: 15 * 60_000 });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const limit = Math.min(10, Math.max(1, typeof body?.limit === "number" ? Math.floor(body.limit) : 3));

  const service = createServiceClient();
  const [{ data: items }, { data: ratings }] = await Promise.all([
    service
      .from("corpus_items")
      .select("id, transcript, side_mapping, topic_title, topic_prompt")
      .in("status", ["rated", "adjudicated"])
      .order("created_at", { ascending: true })
      .limit(100),
    service.from("corpus_ratings").select("corpus_id, rater_id, winner"),
  ]);

  // Group ratings; keep items with >=2 raters whose mapping has no system verdict yet.
  const byItem = new Map<string, RatingRow[]>();
  for (const r of (ratings ?? []) as RatingRow[]) {
    const list = byItem.get(r.corpus_id) ?? [];
    list.push(r);
    byItem.set(r.corpus_id, list);
  }

  const candidates: Array<{ item: CorpusItemRow; consensusWinner: WinnerLabel }> = [];
  for (const item of (items ?? []) as CorpusItemRow[]) {
    const itemRatings = byItem.get(item.id) ?? [];
    if (itemRatings.length < 2) continue;
    const mapping = (item.side_mapping ?? {}) as Record<string, unknown>;
    if (mapping.system_verdict) continue; // already judged once — never re-judge
    candidates.push({
      item,
      consensusWinner: consensusLabel(itemRatings.map((r) => ({ raterId: "r", winner: r.winner as WinnerLabel }))).winner,
    });
  }

  if (!candidates.length) {
    return NextResponse.json({
      judged: 0,
      note: "No agreement-ready items awaiting a system verdict. Import and rate more debates first.",
    });
  }

  const { liveEnsembleJudge, verdictFromEnsemble } = await import("@/lib/ensembleJudge");
  const pairs: ComparisonPair[] = [];
  const errors: string[] = [];

  for (const { item, consensusWinner } of candidates.slice(0, limit)) {
    try {
      const mapping = (item.side_mapping ?? {}) as Record<string, unknown>;
      const aStance = mapping.a_stance === "against" ? "against" : "for";
      const ensemble = await liveEnsembleJudge({
        topicTitle: item.topic_title || "the debate topic",
        topicPrompt: item.topic_prompt || "",
        playerASide: aStance,
        transcript: item.transcript,
      });
      const verdict = verdictFromEnsemble(ensemble);
      await service
        .from("corpus_items")
        .update({
          side_mapping: {
            ...mapping,
            system_verdict: {
              winner: verdict.winner,
              playerAScore: verdict.playerAScore,
              playerBScore: verdict.playerBScore,
              confidence: verdict.confidence ?? null,
              scoreStatus: verdict.scoreStatus ?? null,
            },
          },
        })
        .eq("id", item.id);
      pairs.push({ judgeWinner: verdict.winner, consensusWinner });
    } catch (error) {
      errors.push(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return NextResponse.json({
    ...aggregateSystemComparison(pairs),
    remainingCandidates: Math.max(0, candidates.length - pairs.length - errors.length),
    errors: errors.slice(0, 5),
    note: "Agreement rate is over items where humans agreed first. Disagreements are the calibration signal.",
  });
}
