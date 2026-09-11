import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * BLINDED-RATING INTEGRITY (route level).
 *
 * The server must be the ONLY source of truth for presentation order:
 * assignment is recomputed from (userId, corpusId) on submit, client
 * metadata is ignored, and contributor/duplicate protection stays intact.
 * These tests run the real handlers against an in-memory query builder.
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    user: null as null | { id: string; email?: string },
    tables: {} as Record<string, Row[]>,
  };
  function builder(table: string) {
    const filters: Array<{ kind: "eq" | "in"; col: string; val: unknown }> = [];
    let mode: "select" | "upsert" | "update" = "select";
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
      upsert(v: Row) { mode = "upsert"; payload = v; return b; },
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
        if (mode === "upsert") {
          const p = payload as Row;
          const existing = list.find((r) => r.corpus_id === p.corpus_id && r.rater_id === p.rater_id);
          if (existing) Object.assign(existing, p);
          else list.push({ id: `gen-${table}-${list.length + 1}`, created_at: "2026-01-01T00:00:00Z", ...p });
          return resolve({ data: [], error: null, count: null });
        }
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

import { GET, POST } from "./route";
import { assignPresentationSide, swapTranscriptSides } from "@/lib/corpus";

const NOW = "2026-06-15T12:00:00Z";

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

  it("repeated submissions by one rater overwrite — never duplicate rows", async () => {
    const res1 = await post(ratingBody());
    expect(res1.status).toBe(200);
    const res2 = await post(ratingBody({ winner: "b", rationale: "changed my mind" }));
    expect(res2.status).toBe(200);
    const rows = h.state.tables.corpus_ratings ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].winner).toBe("b");
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

  it("unknown or rejected items 404; status flips to rated at two raters", async () => {
    h.state.user = { id: userWithAssignment("a") };
    const missing = await post({ ...ratingBody(), corpusId: "ghost" });
    expect(missing.status).toBe(404);
    await post(ratingBody());
    expect((h.state.tables.corpus_items ?? [])[0].status).toBe("open");
    h.state.user = { id: userWithAssignment("b") };
    await post(ratingBody({ winner: "a" }));
    expect((h.state.tables.corpus_items ?? [])[0].status).toBe("rated");
  });
});

void NOW;
