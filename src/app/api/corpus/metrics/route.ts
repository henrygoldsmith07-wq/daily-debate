import { NextResponse } from "next/server";
import { loadPublicCorpusMetrics, PUBLIC_CORPUS_METRICS_CACHE_CONTROL } from "@/lib/publicCorpusMetrics";

// Public aggregate metrics for the flagship human-evaluation corpus.
// Exposes counts and percentages only — never transcripts, identities, or
// per-rater data. Numbers appear as null until the underlying stratum has
// enough measured rows; the /metrics page renders those as explicit dashes.

export async function GET() {
  const metrics = await loadPublicCorpusMetrics();
  return NextResponse.json(metrics, { headers: { "Cache-Control": PUBLIC_CORPUS_METRICS_CACHE_CONTROL } });
}
