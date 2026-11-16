import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PUBLIC-SURFACE CONTRACT for the cached corpus-metrics loader.
 *
 * `loadPublicCorpusMetrics` is consumed bare by two surfaces (the /metrics
 * page and GET /api/corpus/metrics), so its failure mode IS the API contract:
 * on a backend read failure it must throw a public-safe error — never leak
 * transport internals — and the cache must be bound to the invalidation tag
 * the rating-writes call (import/correct/rate/adjudicate). Coverage so far
 * only exercised the mocked-away export; nothing enforced the contract.
 */

const h = vi.hoisted(() => {
  const state = {
    items: [] as Array<Record<string, unknown>>,
    ratings: [] as Array<Record<string, unknown>>,
    fail: false,
    /** Tables read through the mock builder, in request order. */
    fromLog: [] as string[],
  };
  type Chain = {
    select: (cols: string) => Chain;
    eq: (col: string, val: unknown) => Chain;
    then: (resolve: (value: unknown) => void) => void;
  };
  function builder(table: string): Chain {
    const chain = {
      select(_cols: string) {
        state.fromLog.push(`${table}:${_cols}`);
        return chain;
      },
      eq() {
        return chain;
      },
      then(resolve: (value: unknown) => void) {
        if (state.fail) {
          resolve({ data: null, error: { message: "connection refused" } });
          return;
        }
        const data = table === "corpus_items" ? state.items : state.ratings;
        resolve({ data, error: null });
      },
    };
    return chain;
  }
  return {
    state,
    from: (t: string) => builder(t),
    reset(items: Array<Record<string, unknown>>, ratings: Array<Record<string, unknown>>) {
      state.items = items;
      state.ratings = ratings;
      state.fail = false;
      state.fromLog = [];
    },
  };
});

// unstable_cache must pass through to the uncached function in tests, but its
// options pin the observable cache key/tags, so capture them for assertions.
const cacheOptions = vi.hoisted(() => ({ keyParts: [] as unknown[], opts: {} as Record<string, unknown> }));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: (...args: unknown[]) => unknown, keyParts: unknown[], opts: Record<string, unknown>) => {
    cacheOptions.keyParts = keyParts;
    cacheOptions.opts = opts;
    return fn;
  },
}));

vi.mock("@/lib/backend/server", () => ({ createServiceClient: () => ({ from: h.from }) }));

const { loadPublicCorpusMetrics, PUBLIC_CORPUS_METRICS_CACHE_CONTROL } = await import("./publicCorpusMetrics");

const item = { id: "c1", side_mapping: { a: "user", b: "ai" }, status: "rated" };

describe("loadPublicCorpusMetrics", () => {
  beforeEach(() => {
    h.reset([item], []);
  });

  it("reads both tables in one parallel shot and delegates aggregation to computeCorpusMetrics", async () => {
    const metrics = await loadPublicCorpusMetrics();
    expect(h.state.fromLog.sort()).toEqual(
      [
        "corpus_items:id, side_mapping, status",
        "corpus_ratings:corpus_id, rater_id, winner, confidence, scores_a, scores_b, presented_first, corrections",
      ].sort(),
    );
    expect(metrics.corpus.items).toBe(1);
  });

  it("throws the public-safe availability error when a backend read fails", async () => {
    h.state.fail = true;
    await expect(loadPublicCorpusMetrics()).rejects.toThrow("Public corpus metrics are temporarily unavailable.");
  });

  it("keeps the failure message free of transport internals", async () => {
    h.state.fail = true;
    const error = await loadPublicCorpusMetrics().catch((e: unknown) => e as Error);
    expect(String(error)).not.toMatch(/connection refused|corpus_items|postgres|supabase/i);
  });
});

describe("cache wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches under the tag the rating-writes invalidate, with bounded freshness", () => {
    // Importing the module registered the cached loader; capture happened above.
    expect(cacheOptions.keyParts).toEqual(["public-corpus-metrics-v1"]);
    expect(cacheOptions.opts.tags).toEqual(["public-corpus-metrics"]);
    expect(cacheOptions.opts.revalidate).toBeGreaterThan(0);
    expect(PUBLIC_CORPUS_METRICS_CACHE_CONTROL).toContain("s-maxage");
  });
});
