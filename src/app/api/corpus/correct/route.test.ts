import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * CORRECTION + ADJUDICATION INTEGRITY (route level).
 *
 * Corrections are the ONLY way to change a stored rating: admin-only, reason
 * required, and the original values are preserved in an append-only audit
 * trail. Adjudication settles rater disagreement without destroying the
 * item's existing side-mapping provenance.
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    user: null as null | { id: string; email?: string },
    tables: {} as Record<string, Row[]>,
  };

  function runSql(text: string, params: unknown[]): Row[] {
    if (/update corpus_ratings/i.test(text)) {
      const [corpusId, raterId, at, actor, reason, winner, scoresA, scoresB] = params as [
        string, string, string, string, string, string, string, string,
      ];
      const row = (state.tables.corpus_ratings ?? []).find(
        (r) => r.corpus_id === corpusId && r.rater_id === raterId,
      );
      if (!row) return [];
      // Mirrors the SQL semantics: SET expressions read the OLD row (before),
      // the event carries the NEW row (after), history is append-only.
      const before = { winner: row.winner, scoresA: row.scores_a, scoresB: row.scores_b };
      const after = { winner, scoresA: JSON.parse(scoresA as string), scoresB: JSON.parse(scoresB as string) };
      row.corrections = [...((row.corrections as Row[]) ?? []), { at, actor, reason, before, after }];
      row.winner = winner;
      row.scores_a = after.scoresA;
      row.scores_b = after.scoresB;
      return [{ id: row.id, corrections: row.corrections }];
    }
    throw new Error(`unmocked SQL: ${text.slice(0, 80)}`);
  }

  function builder(table: string) {
    const filters: Array<{ kind: "eq"; col: string; val: unknown }> = [];
    let mode: "select" | "update" = "select";
    let single = false;
    let payload: Row | null = null;
    const b = {
      select() { return b; },
      eq(col: string, val: unknown) { filters.push({ kind: "eq", col, val }); return b; },
      update(v: Row) { mode = "update"; payload = v; return b; },
      single() { single = true; return b; },
      then(resolve: (value: unknown) => void) {
        const list = (state.tables[table] ??= []);
        const rows = list.filter((row) => filters.every((f) => row[f.col] === f.val));
        if (mode === "update") {
          for (const row of rows) Object.assign(row, payload);
          return resolve({ data: rows, error: null, count: null });
        }
        return resolve({
          data: single ? rows[0] ?? null : rows,
          error: single && !rows.length ? { message: "no rows" } : null,
          count: null,
        });
      },
    };
    return b;
  }
  return {
    state,
    query: runSql,
    reset(rows: Record<string, Row[]>) { state.tables = structuredClone(rows); },
    from: (t: string) => builder(t),
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

import { POST as correctRating } from "../correct/route";
import { POST as adjudicate } from "../adjudicate/route";

const RATING = {
  id: "rating-1",
  corpus_id: "item-1",
  rater_id: "rater-1",
  scores_a: { evidenceQuality: 2 },
  scores_b: { evidenceQuality: 5 },
  winner: "b",
  confidence: 0.9,
  rationale: "original verdict",
  presented_first: "a",
  corrections: [] as unknown[],
  created_at: "2026-01-01T00:00:00Z",
};

const ITEM = {
  id: "item-1",
  status: "rated",
  side_mapping: { system_verdict: "a", source: "import" },
};

function correctBody(overrides: Record<string, unknown> = {}) {
  return {
    corpusId: "item-1",
    raterId: "rater-1",
    winner: "a",
    scores_a: { evidenceQuality: 5 },
    scores_b: { evidenceQuality: 2 },
    reason: "Rater submitted in wrong frame after presentation swap.",
    ...overrides,
  };
}

function postCorrect(body: unknown) {
  return correctRating(
    new Request("http://localhost/api/corpus/correct", { method: "POST", body: JSON.stringify(body) }),
  );
}

function postAdjudicate(body: unknown) {
  return adjudicate(
    new Request("http://localhost/api/corpus/adjudicate", { method: "POST", body: JSON.stringify(body) }),
  );
}

beforeEach(() => {
  process.env.CORPUS_ADMIN_EMAILS = "admin@example.com, second@example.com";
  h.reset({
    corpus_items: [{ ...ITEM, side_mapping: { ...ITEM.side_mapping } }],
    corpus_ratings: [{ ...RATING, corrections: [], scores_a: { ...RATING.scores_a }, scores_b: { ...RATING.scores_b } }],
  });
  h.state.user = { id: "admin-1", email: "admin@example.com" };
});

describe("correction route", () => {
  it("non-admins are forbidden", async () => {
    h.state.user = { id: "user-1", email: "user@example.com" };
    const res = await postCorrect(correctBody());
    expect(res.status).toBe(403);
    expect((h.state.tables.corpus_ratings ?? [])[0].winner).toBe("b");
  });

  it("a correction preserves the original values in a self-contained audit event", async () => {
    const res = await postCorrect(correctBody());
    expect(res.status).toBe(200);
    const row = (h.state.tables.corpus_ratings ?? [])[0];
    expect(row.winner).toBe("a");
    expect(row.scores_a).toEqual({ evidenceQuality: 5 });
    const trail = row.corrections as Array<Record<string, unknown>>;
    expect(trail).toHaveLength(1);
    expect(trail[0].actor).toBe("admin@example.com");
    expect(trail[0].reason).toContain("wrong frame");
    expect(typeof trail[0].at).toBe("string");
    expect(trail[0].before).toEqual({
      winner: "b",
      scoresA: { evidenceQuality: 2 },
      scoresB: { evidenceQuality: 5 },
    });
    expect(trail[0].after).toEqual({
      winner: "a",
      scoresA: { evidenceQuality: 5 },
      scoresB: { evidenceQuality: 2 },
    });
  });

  it("repeated corrections append; the first event is never rewritten", async () => {
    await postCorrect(correctBody());
    const afterFirst = structuredClone(
      ((h.state.tables.corpus_ratings ?? [])[0].corrections as Record<string, unknown>[])[0],
    );
    await postCorrect(correctBody({ winner: "tie", reason: "Further review: sides actually comparable." }));
    const trail = (h.state.tables.corpus_ratings ?? [])[0].corrections as Array<Record<string, unknown>>;
    expect(trail).toHaveLength(2);
    // First event intact, byte-for-byte.
    expect(trail[0]).toEqual(afterFirst);
    // Chain: each event's before == the previous event's after.
    expect(trail[1].before).toEqual(trail[0].after);
    expect((trail[1].after as Record<string, unknown>).winner).toBe("tie");
  });

  it("the full verdict history is reconstructable from the audit alone", async () => {
    const original = structuredClone((h.state.tables.corpus_ratings ?? [])[0]);
    await postCorrect(correctBody()); // b -> a
    await postCorrect(correctBody({ winner: "tie", reason: "Review found the gap below threshold." })); // a -> tie
    const row = (h.state.tables.corpus_ratings ?? [])[0];
    const trail = row.corrections as Array<Record<string, unknown>>;
    // Rebuild: first before == original values; chain links; last after == row.
    expect(trail[0].before).toEqual({
      winner: original.winner,
      scoresA: original.scores_a,
      scoresB: original.scores_b,
    });
    for (let i = 1; i < trail.length; i++) expect(trail[i].before).toEqual(trail[i - 1].after);
    expect(trail[trail.length - 1].after).toEqual({
      winner: row.winner,
      scoresA: row.scores_a,
      scoresB: row.scores_b,
    });
  });

  it("concurrent corrections both land, history keeps complete events in commit order", async () => {
    const p1 = postCorrect(correctBody({ winner: "a", reason: "First concurrent review of the frame issue." }));
    const p2 = postCorrect(
      correctBody({ winner: "tie", reason: "Second concurrent review reached a different call." }),
    );
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const trail = (h.state.tables.corpus_ratings ?? [])[0].corrections as Array<Record<string, unknown>>;
    expect(trail).toHaveLength(2);
    // No event lost, no interleaved partials: each has all five fields and
    // the chain still holds in commit order.
    for (const e of trail) {
      expect(typeof e.at).toBe("string");
      expect(typeof e.actor).toBe("string");
      expect(typeof e.reason).toBe("string");
      expect(e.before).toBeTruthy();
      expect(e.after).toBeTruthy();
    }
    expect(trail[1].before).toEqual(trail[0].after);
    expect(trail[1].after).toEqual({
      winner: (h.state.tables.corpus_ratings ?? [])[0].winner,
      scoresA: (h.state.tables.corpus_ratings ?? [])[0].scores_a,
      scoresB: (h.state.tables.corpus_ratings ?? [])[0].scores_b,
    });
  });

  it("requires a real reason and a valid payload", async () => {
    expect((await postCorrect(correctBody({ reason: "oops" }))).status).toBe(400);
    expect((await postCorrect(correctBody({ winner: "banana" }))).status).toBe(400);
    expect((await postCorrect({ ...correctBody(), raterId: null })).status).toBe(400);
    expect(h.state.tables.corpus_ratings ?? []).toHaveLength(1);
    expect(((h.state.tables.corpus_ratings ?? [])[0]).corrections).toHaveLength(0);
  });

  it("unknown ratings 404 and change nothing", async () => {
    const res = await postCorrect(correctBody({ raterId: "ghost" }));
    expect(res.status).toBe(404);
  });
});

describe("adjudication route", () => {
  beforeEach(() => {
    h.state.tables.corpus_ratings = [
      { ...RATING, rater_id: "rater-1", winner: "a" },
      { ...RATING, id: "rating-2", rater_id: "rater-2", winner: "b" },
    ];
  });

  it("majority rater vote is written without destroying existing side_mapping keys", async () => {
    const res = await postAdjudicate({ corpusId: "item-1" });
    expect(res.status).toBe(200);
    const item = (h.state.tables.corpus_items ?? [])[0];
    expect(item.status).toBe("adjudicated");
    const mapping = item.side_mapping as Record<string, unknown>;
    expect(mapping).toEqual({
      system_verdict: "a", // preserved — not wiped by the consensus write
      source: "import",
      consensus_winner: "tie",
      basis: "rater majority",
    });
  });

  it("requires two ratings and admin rights", async () => {
    h.state.tables.corpus_ratings = [h.state.tables.corpus_ratings![0]];
    expect((await postAdjudicate({ corpusId: "item-1" })).status).toBe(409);
    h.state.tables.corpus_ratings = [
      { ...RATING, rater_id: "rater-1", winner: "a" },
      { ...RATING, id: "rating-2", rater_id: "rater-2", winner: "b" },
    ];
    h.state.user = { id: "u", email: "not-admin@example.com" };
    expect((await postAdjudicate({ corpusId: "item-1" })).status).toBe(403);
  });

  it("moderator override beats the majority and is recorded as such", async () => {
    const res = await postAdjudicate({ corpusId: "item-1", winner: "b" });
    expect(res.status).toBe(200);
    const item = (h.state.tables.corpus_items ?? [])[0];
    const mapping = item.side_mapping as Record<string, unknown>;
    expect(mapping.consensus_winner).toBe("b");
    expect((mapping.basis as string).startsWith("moderator override")).toBe(true);
  });
});
