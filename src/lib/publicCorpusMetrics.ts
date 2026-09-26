import "server-only";

import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/backend/server";
import { computeCorpusMetrics, type MetricItem, type MetricRating } from "@/lib/corpusMetrics";

const PUBLIC_METRICS_REVALIDATE_SECONDS = 300;

async function loadPublicCorpusMetricsUncached() {
  const service = createServiceClient();
  const [itemsResult, ratingsResult] = await Promise.all([
    service.from("corpus_items").select("id, side_mapping, status"),
    service
      .from("corpus_ratings")
      .select("corpus_id, rater_id, winner, confidence, scores_a, scores_b, presented_first, corrections"),
  ]);

  if (itemsResult.error || ratingsResult.error) {
    throw new Error("Public corpus metrics are temporarily unavailable.");
  }

  return computeCorpusMetrics(
    (itemsResult.data ?? []) as MetricItem[],
    (ratingsResult.data ?? []) as unknown as MetricRating[],
  );
}

/**
 * Public trust metrics change slowly and are identical for every viewer.
 * Cache the expensive full-corpus aggregation while keeping freshness bounded.
 */
export const loadPublicCorpusMetrics = unstable_cache(
  loadPublicCorpusMetricsUncached,
  ["public-corpus-metrics-v1"],
  { revalidate: PUBLIC_METRICS_REVALIDATE_SECONDS, tags: ["public-corpus-metrics"] },
);

export const PUBLIC_CORPUS_METRICS_CACHE_CONTROL =
  `public, s-maxage=${PUBLIC_METRICS_REVALIDATE_SECONDS}, stale-while-revalidate=${PUBLIC_METRICS_REVALIDATE_SECONDS * 2}`;
