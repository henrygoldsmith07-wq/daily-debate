import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { computeCorpusMetrics, type MetricItem, type MetricRating } from "@/lib/corpusMetrics";

// Public aggregate metrics for the flagship human-evaluation corpus.
// Exposes counts and percentages only — never transcripts, identities, or
// per-rater data. Numbers appear as null until the underlying stratum has
// enough measured rows; the /metrics page renders those as explicit dashes.

export async function GET() {
  const service = createServiceClient();
  const [{ data: items }, { data: ratings }] = await Promise.all([
    service.from("corpus_items").select("id, side_mapping"),
    service.from("corpus_ratings").select("corpus_id, rater_id, winner, confidence, scores_a, scores_b"),
  ]);

  const metrics = computeCorpusMetrics(
    (items ?? []) as MetricItem[],
    (ratings ?? []) as unknown as MetricRating[],
  );

  return NextResponse.json(metrics, { headers: { "Cache-Control": "no-store" } });
}
