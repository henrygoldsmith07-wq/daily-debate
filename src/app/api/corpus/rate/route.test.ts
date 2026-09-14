import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * BLINDED-RATING INTEGRITY (route level).
 *
 * The server must be the ONLY source of truth for presentation order:
 * assignment is recomputed from (userId, corpusId) on submit, client
 * metadata is ignored, and contributor/duplicate protection stays intact.
 * Ratings are IMMUTABLE: a second submission by the same rater is rejected
 * (409), never overwritten. These tests run the real handlers against an
 * in-memory query builder plus a faithful simulation of the atomic
 * insert/lock statement used in production (src/lib/corpusRatingStore.ts).
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    user: null as null | { id: string; email?: string },
    tables: {} as Record<string, Row[]>,
  };

  /** Faithful simulation of the single locked CTE in corpusRatingStore. */
  function runImmutableInsert(text: string, params: unknown[]): Row[] {
    if (/with guard/i.test(text)) {
      const [corpusId, raterId, scoresA, scoresB, winner, confidence, rationale, presentedFirst, minRaters] =
        params as [string, string, string, string, string, number, string, string, number];
      const items = state.tables.corpus_items ?? [];
      const item = items.find((i) => i.id === corpusId);
      const ratings = state.tables.corpus_ratings ?? [];
      const duplicate = ratings.find((r) => r.corpus_id === corpusId && r.rater_id === raterId);
      // FOR UPDATE semantics: the item must be open AT insert time, and a
      // duplicate (corpus_id, rater_id) is a no-op. Both checks happen under
      // the lock, so concurrent submissions serialise exactly like Postgres.
      if (item && item.status === "open" && !duplicate) {
        ratings.push({
          id: `gen-rating-${ratings.length + 1}`,
          corpus_id: corpusId,
          rater_id: raterId,
          scores_a: JSON.parse(scoresA as string),
          scores_b: JSON.parse(scoresB as string),
          winner,
          confidence,
          rationale,
          presented_first: presentedFirst,
          corrections: [],
          created_at: "2026-01-01T00:00:00Z",
        });
        const count = ratings.filter((r) => r.corpus_id === corpusId).length;
        if (count >= minRaters) {
          item.status = "rated";
          return [{ inserted: 1, flipped: 1 }];
        }
        return [{ inserted: 1, flipped: 0 }];
      }
      return [{ inserted: 0, flipped: 0 }];
    }
    if (/select id from corpus_ratings where corpus_id/i.test(text)) {
      const [corpusId, raterId] = params as [string, string];
      const found = (state.tables.corpus_ratings ?? []).find(
        (r) => r.corpus_id === corpusId && r.rater_id === raterId,
      );
      return found ? [{ id: found.id }] : [];
    }
    if (/select status from corpus_items where id/i.test(text)) {
      const [corpusId] = params as [string];
      const item = (state.tables.corpus_items ?? []).find((i) => i.id === corpusId);
      return item ? [{ status: item.status }] : [];
    }
    if (/update corpus_ratings/i.test(text)) {
      const [corpusId, raterId, at, actor, reason, winner, scoresA, scoresB] = params as [
        string, string, string, string, string, string, string, string,
      ];
      const row = (state.tables.corpus_ratings ?? []).find(
        (r) => r.corpus_id === corpusId && r.rater_id === raterId,
      );
      if (!row) return [];
      const previous = { winner: row.winner, scoresA: row.scores_a, scoresB: row.scores_b };
      row.corrections = [
        ...((row.corrections as Row[]) ?? []),
        { at, actor, reason, previous },
      ];
      row.winner = winner;
      row.scores_a = JSON.parse(scoresA as string);
      row.scores_b = JSON.parse(scoresB as string);
      return [{ id: row.id, corrections: row.corrections }];
    }
    throw new Error(`unmocked SQL: ${text.slice(0, 80)}`);
  }

  function builder(table: string) {
    const filters: Array<{ kind: "eq" | "in"; col: string; val: unknown }> = [];
    let mode: "select" | "update" = "select";
    let single = false;
    let wantCount = false;
    let payload: Row | null = null;
    const b = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count === "exact") wantCount = true;
        return b;
      },
      eq(col: string, val: unknown) { filters.push({ kind: "eq", col, val }); return b; },
      in(col: string, vals: unknown[]) { filters.push({ kind: "in", col, val: vals }); return b; },
      order() { return b; },
      limit() { return b; },
      single() { single = true; return b; },
      maybeSingle() { single = true; return b; },
      update(v: Row) { mode = "update"; payload = v; return b; },
      then(resolve: (value: unknown) => void) {
        const list = (state.tables[table] ??= []);
        const rows = list.filter((row) =>
          filters.every((f) =>
            f.kind === "eq"
              ? row[f.col] === f.val
              : (f.val as unknown[]).includes(row[f.col]),
          ),
        );
        if (mode === "update") {
          for (const row of rows) Object.assign(row, payload);
          return resolve({ data: [], error: null, count: null });
        }
        const data = single ? rows[0] ?? null : rows;
        return resolve({
          data,
          error: single && !rows.length ? { message: "no rows" } : null,
          count: wantCount ? rows.length : null,
        });
      },
    };
    return b;
  }
  return {
    state,
    query: runImmutableInsert,
    reset(rows: Record<string, Row[]>) {
      state.tables = structuredClone(rows);
    },
    from: (_t: string) => builder(_t),
  };
});

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => null }));
vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
  }),
  createServiceClient: () => ({ from: h.from }),
}));
vi.mock("@/lib/backend/sql", () => ({
  queryRows: async (text: string, params: unknown[]) => h.query(text, params),
}));

import { GET, POST } from "./route";
import { assignPresentationSide, swapTranscriptSides } from "@/lib/corpus";

const ITEM_A = {
  id: "item-1",
  transcript: "Side A (round 1): Alpha first.\nSide B (round 1): Beta replies.",
  topic: "Should cities ban parking minimums?",
  contributor_id: "author-9",
  status: "open",
};

function ratingBody(overrides: Record<string, unknown> = {}) {
  return {
    corpusId: "item-1",
    scores_a: { evidenceQuality: 5, reasoning: 4, relevance: 4, rebuttalQuality: 5, logicalValidity: 4, sourceQuality: 5 },
    scores_b: { evidenceQuality: 2, reasoning: 2, relevance: 3, rebuttalQuality: 1, logicalValidity: 2, sourceQuality: 2 },
    winner: "a",
    confidence: 0.8,
    rationale: "Side A grounded every claim; Side B asserted.",
    ...overrides,
  };
}

function post(body: unknown) {
  return POST(new Request("http://localhost/api/corpus/rate", { method: "POST", body: JSON.stringify(body) }));
}

function storedRating(raterId: string) {
  return (h.state.tables.corpus_ratings ?? []).find((r) => r.rater_id === raterId);
}

/** A user whose deterministic assignment for item-1 is "a"/"b" (searched, not assumed). */
function userWithAssignment(want: "a" | "b"): string {
  for (let i = 0; i < 500; i++) {
    const id = `rater-${i}`;
    if (assignPresentationSide(id, ITEM_A.id) === want) return id;
  }
  throw new Error(`no user id assigns ${want} for ${ITEM_A.id}`);
}

beforeEach(() => {
  h.reset({ corpus_items: [ITEM_A], corpus_ratings: [] });
  h.state.user = { id: userWithAssignment("a") };
});

describe("GET blind assignment", () => {
  it("presents the transcript exactly as the server-side assignment dictates", async () => {
    for (const want of ["a", "b"] as const) {
      h.state.user = { id: userWithAssignment(want) };
      const res = await GET(new Request("http://localhost/api/corpus/rate"));
      const json = (await res.json()) as {
        presentedFirst: string;
        item: { transcript: string; id: string };
      };
      expect(json.presentedFirst).toBe(want);
      expect(json.item.transcript).toBe(
        want === "b" ? swapTranscriptSides(ITEM_A.transcript) : ITEM_A.transcript,
      );
    }
  });

  it("excludes items the rater authored", async () => {
    h.state.user = { id: "author-9" };
    const res = await GET(new Request("http://localhost/api/corpus/rate"));
    const json = (await res.json()) as { item: unknown };
    expect(json.item).toBeNull();
  });
});

describe("POST integrity: presentation metadata is server-owned", () => {
  it("a forged presentedFirst cannot swap stored coordinates", async () => {
    const user = userWithAssignment("a"); // server truth: "a"
    h.state.user = { id: user };
    const body = { ...ratingBody(), presentedFirst: "b" }; // lie: claim b-first
    const res = await post(body);
    expect(res.status).toBe(200);
    const stored = storedRating(user) as Record<string, unknown>;
    // No normalisation applied despite the forged field.
    expect(stored.winner).toBe("a");
    expect(stored.scores_a).toEqual(body.scores_a);
    expect(stored.scores_b).toEqual(body.scores_b);
    expect(stored.presented_first).toBe("a");
  });

  it("a genuine b-first rater is normalised even when they omit (or fake) the field", async () => {
    const user = userWithAssignment("b"); // server truth: "b"
    h.state.user = { id: user };
    // Rater saw sides swapped: submitted "a" actually means original side B.
    const res = await post(ratingBody({ presentedFirst: "a" }));
    expect(res.status).toBe(200);
    const stored = storedRating(user) as Record<string, unknown>;
    expect(stored.winner).toBe("b");
    expect(stored.scores_a).toEqual(ratingBody().scores_b);
    expect(stored.scores_b).toEqual(ratingBody().scores_a);
    expect(stored.presented_first).toBe("b");
  });

  it("two raters with opposite presentation still converge in stored coordinates", async () => {
    const aUser = userWithAssignment("a");
    const bUser = userWithAssignment("b");
    h.state.user = { id: aUser };
    await post(ratingBody()); // winner a
    h.state.user = { id: bUser };
    // The b-first rater sees side A second; preferring it means winner "b"
    // in presented coordinates → stored as "a" in original coordinates.
    await post(ratingBody({ winner: "b" }));
    const stored = (h.state.tables.corpus_ratings ?? []).map((r) => r.winner);
    expect(stored).toEqual(["a", "a"]);
  });
});

describe("POST immutability and closure (append-once ratings)", () => {
  it("a second submission by the same rater is rejected, the original preserved", async () => {
    const user = userWithAssignment("a");
    h.state.user = { id: user };
    const first = await post(ratingBody());
    expect(first.status).toBe(200);
    const second = await post(ratingBody({ winner: "b", rationale: "changed my mind" }));
    expect(second.status).toBe(409);
    const rows = h.state.tables.corpus_ratings ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].winner).toBe("a"); // ORIGINAL verdict untouched
    expect(rows[0].rationale).toBe("Side A grounded every claim; Side B asserted.");
  });

  it("closure races: two simultaneous final raters produce exactly one closure, no overwrites", async () => {
    // One rating already stored (min raters = 2): the next TWO submissions
    // race for the final slot.
    const firstUser = userWithAssignment("a");
    h.reset({
      corpus_items: [{ ...ITEM_A }],
      corpus_ratings: [
        {
          id: "r0", corpus_id: "item-1", rater_id: firstUser,
          scores_a: {}, scores_b: {}, winner: "a", confidence: 0.7,
          rationale: "first", presented_first: "a", corrections: [],
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const raterB = userWithAssignment("b");
    const raterA2 = ((): string => {
      // a third distinct user (assignment irrelevant, must differ from raterB)
      for (let i = 500; i < 1000; i++) {
        const id = `rater-${i}`;
        if (id !== raterB) return id;
      }
      return "rater-x";
    })();
    h.state.user = { id: raterB };
    const p1 = post(ratingBody());
    h.state.user = { id: raterA2 };
    const p2 = post(ratingBody({ winner: "b" }));
    const [res1, res2] = await Promise.all([p1, p2]);

    const statuses = [res1.status, res2.status].sort();
    const rows = h.state.tables.corpus_ratings ?? [];
    // Exactly one of the two racing submissions lands; the item closes at
    // the required rating count (2), never above it.
    expect(statuses).toEqual([200, 409]);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.corpus_id === "item-1").length).toBe(2);
    expect((h.state.tables.corpus_items ?? [])[0].status).toBe("rated");
  });

  it("closed items (rated/adjudicated/rejected) refuse new normal ratings", async () => {
    for (const status of ["rated", "adjudicated", "rejected"] as const) {
      h.reset({ corpus_items: [{ ...ITEM_A, status }], corpus_ratings: [] });
      h.state.user = { id: userWithAssignment("a") };
      const res = await post(ratingBody());
      expect(res.status).toBe(409);
      expect(h.state.tables.corpus_ratings ?? []).toHaveLength(0);
    }
  });

  it("unknown items 404; item closes exactly when the required count is reached", async () => {
    h.state.user = { id: userWithAssignment("a") };
    const missing = await post({ ...ratingBody(), corpusId: "ghost" });
    expect(missing.status).toBe(404);

    await post(ratingBody());
    expect((h.state.tables.corpus_items ?? [])[0].status).toBe("open");
    h.state.user = { id: userWithAssignment("b") };
    const res = await post(ratingBody({ winner: "a" }));
    expect(res.status).toBe(200);
    expect((h.state.tables.corpus_items ?? [])[0].status).toBe("rated");
    // Late arrival after closure: rejected, not silently appended.
    h.state.user = { id: userWithAssignment("a") === userWithAssignment("b") ? "x" : "late-rater" };
    h.state.user = { id: `late-${userWithAssignment("a")}` };
    const late = await post(ratingBody());
    expect(late.status).toBe(409);
  });

  it("authors cannot rate their own debates", async () => {
    h.state.user = { id: "author-9" };
    const res = await post(ratingBody());
    expect(res.status).toBe(403);
    expect(h.state.tables.corpus_ratings ?? []).toHaveLength(0);
  });

  it("rejects malformed payloads before any write", async () => {
    h.state.user = { id: userWithAssignment("a") };
    const res = await post({ ...ratingBody(), scores_a: null });
    expect(res.status).toBe(400);
    expect(h.state.tables.corpus_ratings ?? []).toHaveLength(0);
  });
});
