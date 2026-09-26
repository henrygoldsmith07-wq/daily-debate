import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { aggregateSystemComparison, type ComparisonPair } from "@/lib/corpus";
import type { WinnerLabel } from "@/lib/humanCorpus";
import { getRequestAuthContext } from "@/lib/requestAuth";
import { hasUsableHumanGroundTruth, resolveHumanGroundTruth } from "@/lib/humanGroundTruth";
import {
  claimCorpusSystemJudge,
  persistCorpusSystemVerdict,
  releaseCorpusSystemJudgeClaim,
} from "@/lib/corpusVerdictStore";
import { invalidatePublicCorpusMetrics } from "@/lib/publicCorpusMetrics";

interface CorpusItemRow {
  id: string;
  transcript: string;
  side_mapping: unknown;
  status: string;
  topic_title: string;
  topic_prompt: string;
}

interface RatingRow {
  corpus_id: string;
  rater_id: string;
  winner: string;
}

// Admin-only, explicit, costed: runs the live ensemble judge over
// resolved-human-truth corpus items (strict rater consensus OR explicit,
// non-stale moderator adjudication) and compares the judge's winner against
// that canonical target. Unresolved or stale disagreements never reach a live
// model call.

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "corpus-syscomp", limit: 4, windowMs: 15 * 60_000 });
  if (limited) return limited;

  const auth = await getRequestAuthContext();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const limit = Math.min(10, Math.max(1, typeof body?.limit === "number" ? Math.floor(body.limit) : 3));

  const service = createServiceClient();
  const [{ data: items }, { data: ratings }] = await Promise.all([
    service
      .from("corpus_items")
      .select("id, transcript, side_mapping, status, topic_title, topic_prompt")
      .in("status", ["rated", "adjudicated"])
      .order("created_at", { ascending: true })
      .limit(100),
    service.from("corpus_ratings").select("corpus_id, rater_id, winner"),
  ]);

  // Group ratings; only canonical human ground truth (strict consensus or a
  // non-stale adjudication) may become a system-comparison target.
  const byItem = new Map<string, RatingRow[]>();
  for (const r of (ratings ?? []) as RatingRow[]) {
    const list = byItem.get(r.corpus_id) ?? [];
    list.push(r);
    byItem.set(r.corpus_id, list);
  }

  const candidates: Array<{ item: CorpusItemRow; consensusWinner: WinnerLabel }> = [];
  for (const item of (items ?? []) as CorpusItemRow[]) {
    const itemRatings = byItem.get(item.id) ?? [];
    const mapping = (item.side_mapping ?? {}) as Record<string, unknown>;
    if (mapping.system_verdict) continue; // already judged once — never re-judge
    const humanTruth = resolveHumanGroundTruth(
      item,
      itemRatings.map((r) => ({ rater_id: r.rater_id, winner: r.winner })),
    );
    if (!hasUsableHumanGroundTruth(humanTruth)) continue;
    candidates.push({
      item,
      consensusWinner: humanTruth.winner,
    });
  }

  if (!candidates.length) {
    return NextResponse.json({
      judged: 0,
      note: "No resolved human-ground-truth items are awaiting a system verdict. Import, rate, or adjudicate more debates first.",
    });
  }

  const { liveEnsembleJudge, verdictFromEnsemble } = await import("@/lib/ensembleJudge");
  const { verifyGraphCitations } = await import("@/lib/citationVerifier");
  const pairs: ComparisonPair[] = [];
  const errors: string[] = [];
  let skippedClaims = 0;
  const swapCheck = body?.swapCheck === true;

  for (const { item, consensusWinner } of candidates.slice(0, limit)) {
    const claim = await claimCorpusSystemJudge(item.id);
    if (!claim) {
      skippedClaims++;
      continue;
    }
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

      // Citation-integrity telemetry for the published metrics: how many
      // cited evidence nodes did the verifier flag on this judged graph?
      const graph = verdict.argGraph;
      const citedNodes = (graph?.nodes ?? []).filter((n) => n.kind === "evidence" && (n.citations?.length ?? 0) > 0);
      const citationFlags =
        citedNodes.length > 0 ? { cited: citedNodes.length, flagged: verifyGraphCitations(graph!).length } : undefined;

      let systemVerdict: Record<string, unknown> = {
        winner: verdict.winner,
        playerAScore: verdict.playerAScore,
        playerBScore: verdict.playerBScore,
        confidence: verdict.confidence ?? null,
        scoreStatus: verdict.scoreStatus ?? null,
        ...(citationFlags ? { citationFlags } : {}),
      };
      // Optional position-swap stability probe: judge the mirrored debate and
      // check the winner mirrors too. Doubles model cost for this item.
      if (swapCheck && graph) {
        try {
          const swappedTranscript = item.transcript
            .replaceAll("Side A", "Side §")
            .replaceAll("Side B", "Side A")
            .replaceAll("Side §", "Side B");
          const swapEnsemble = await liveEnsembleJudge({
            topicTitle: item.topic_title || "the debate topic",
            topicPrompt: item.topic_prompt || "",
            playerASide: aStance === "for" ? "against" : "for",
            transcript: swappedTranscript,
          });
          const swapVerdict = verdictFromEnsemble(swapEnsemble);
          const mirror: Record<string, string> = { a: "b", b: "a", tie: "tie" };
          const stable = mirror[swapVerdict.winner] === verdict.winner;
          systemVerdict = { ...systemVerdict, swap_check: { stable } };
        } catch (swapError) {
          errors.push(`swap ${item.id}: ${swapError instanceof Error ? swapError.message : String(swapError)}`);
        }
      }

      const persisted = await persistCorpusSystemVerdict(item.id, claim.token, systemVerdict);
      if (!persisted) {
        errors.push(`${item.id}: system verdict claim was lost before persistence`);
        continue;
      }
      invalidatePublicCorpusMetrics();
      pairs.push({ judgeWinner: verdict.winner, consensusWinner });
    } catch (error) {
      await releaseCorpusSystemJudgeClaim(item.id, claim.token).catch(() => undefined);
      errors.push(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return NextResponse.json({
    ...aggregateSystemComparison(pairs),
    remainingCandidates: Math.max(0, candidates.length - pairs.length),
    skippedClaims,
    errors: errors.slice(0, 5),
    note: "Agreement rate is over canonical human ground truth: strict independent-rater consensus or explicit non-stale adjudication. Unresolved disagreements remain calibration evidence and are excluded.",
  });
}
