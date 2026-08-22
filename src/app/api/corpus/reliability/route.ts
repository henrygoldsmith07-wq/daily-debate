import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isCorpusAdmin, completeScores, populationProgress } from "@/lib/corpus";
import { iccTwoWay, EVAL_DIMENSIONS, type SideScores } from "@/lib/debateEvaluation";
import { cohenKappa } from "@/lib/humanCorpus";
import type { WinnerLabel } from "@/lib/humanCorpus";

// Admin-only: human-human reliability FIRST. Reports per-dimension ICC and
// pairwise winner kappa over fully-rated corpus items, counts items whose
// raters disagree for adjudication, and reports how many items are
// "agreement-ready" — the only ones where system-human accuracy may be
// scored later.

interface RatingRow {
  corpus_id: string;
  rater_id: string;
  scores_a: unknown;
  scores_b: unknown;
  winner: string;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createServiceClient();
  const [{ data: items }, { data: ratingRows }] = await Promise.all([
    service.from("corpus_items").select("id, status, length_bucket, subject_category, ability_band"),
    service.from("corpus_ratings").select("corpus_id, rater_id, scores_a, scores_b, winner"),
  ]);

  const byItem = new Map<string, RatingRow[]>();
  for (const r of (ratingRows ?? []) as RatingRow[]) {
    const list = byItem.get(r.corpus_id) ?? [];
    list.push(r);
    byItem.set(r.corpus_id, list);
  }

  // Per-dimension ICC across raters (units = items, one column per rater;
  // items with fewer than two raters are dropped per dimension).
  const perDimensionIcc: Record<string, number | null> = {};
  for (const dim of EVAL_DIMENSIONS) {
    for (const side of ["a", "b"] as const) {
      const matrix: number[][] = [];
      for (const itemRatings of byItem.values()) {
        if (itemRatings.length < 2) continue;
        matrix.push(itemRatings.map((r) => completeScores(r[`scores_${side}`] as Partial<SideScores>)[dim]));
      }
      if (matrix.length >= 3) {
        perDimensionIcc[`${dim}:${side}`] = Number(iccTwoWay(matrix).single.toFixed(3));
      }
    }
  }

  // Winner agreement per item; disagreement → flagged for adjudication.
  let agreementReady = 0;
  let needsAdjudication = 0;
  const adjudicationQueue: Array<{ id: string; verdicts: WinnerLabel[] }> = [];
  for (const [itemId, itemRatings] of byItem) {
    if (itemRatings.length < 2) continue;
    const winners = itemRatings.map((r) => r.winner as WinnerLabel);
    if (winners.every((w) => w === winners[0])) agreementReady += 1;
    else {
      needsAdjudication += 1;
      if (adjudicationQueue.length < 50) adjudicationQueue.push({ id: itemId, verdicts: winners });
    }
  }

  // Cohen's kappa per rater pair over their commonly-rated items.
  const pairsByRater = new Map<string, Map<string, Array<[WinnerLabel, WinnerLabel]>>>();
  for (const itemRatings of byItem.values()) {
    if (itemRatings.length !== 2) continue;
    const [x, y] = [...itemRatings].sort((a, b) => a.rater_id.localeCompare(b.rater_id));
    const inner = pairsByRater.get(x.rater_id) ?? new Map<string, Array<[WinnerLabel, WinnerLabel]>>();
    const seq = inner.get(y.rater_id) ?? [];
    seq.push([x.winner as WinnerLabel, y.winner as WinnerLabel]);
    inner.set(y.rater_id, seq);
    pairsByRater.set(x.rater_id, inner);
  }
  const kappas: number[] = [];
  for (const inner of pairsByRater.values()) {
    for (const seq of inner.values()) {
      if (seq.length >= 5) kappas.push(cohenKappa(seq.map(([a]) => a), seq.map(([, b]) => b)));
    }
  }

  // Strata coverage — population targets need spread across subjects,
  // ability levels, and argument lengths.
  const ratingCounts = new Map<string, number>();
  for (const r of (ratingRows ?? []) as RatingRow[]) {
    ratingCounts.set(r.corpus_id, (ratingCounts.get(r.corpus_id) ?? 0) + 1);
  }
  const progress = populationProgress(
    (items ?? []).map((i) => ({
      id: i.id,
      length_bucket: i.length_bucket,
      ability_band: i.ability_band,
      subject_category: i.subject_category,
    })),
    ratingCounts,
  );
  const confidences = ((ratingRows ?? []) as Array<RatingRow & { confidence?: number | null }>)
    .map((r) => r.confidence)
    .filter((c): c is number => typeof c === "number");

  return NextResponse.json({
    totalItems: progress.totalItems,
    fullyRatedItems: progress.fullyRatedItems,
    ratedItems: byItem.size,
    agreementReady,
    needsAdjudication,
    adjudicationQueue,
    meanWinnerKappa: kappas.length ? Number((kappas.reduce((s, k) => s + k, 0) / kappas.length).toFixed(3)) : null,
    perDimensionIcc,
    strata: {
      byLength: progress.byLength,
      byAbility: progress.byAbility,
      bySubject: progress.bySubject,
    },
    population: {
      targetItems: progress.targetItems,
      remainingToTarget: progress.remainingToTarget,
      cellsNeedingCoverage: progress.cellsNeedingCoverage,
      meanRaterConfidence: confidences.length
        ? Number((confidences.reduce((s, c) => s + c, 0) / confidences.length).toFixed(3))
        : null,
    },
    note: "System-vs-human accuracy must only be computed over agreementReady items.",
  });
}
