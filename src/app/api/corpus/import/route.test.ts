import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * IMPORT-LOOP QUERY BUDGET (route level, offline).
 *
 * Import walks every completed debate; contributor levels and topics used to
 * be read per debate (two extra queries per debate, sequential with the
 * turns read). They are now batched into one `in` query per table per source
 * type, so the per-debate loop keeps only the genuinely per-debate read — the
 * turns. The whole import run must stay a constant number of list queries
 * regardless of how many debates are pending.
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    user: null as null | { id: string },
    isAdmin: false,
    tables: {} as Record<string, Row[]>,
    /** Every table read through the builder, in request order. */
    fromLog: [] as string[],
  };

  function builder(table: string) {
    const filters: Array<{ col: string; val: unknown }> = [];
    const inFilters: Array<{ col: string; vals: unknown[] }> = [];
    let single = false;
    const b = {
      select() {
        return b;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, val });
        return b;
      },
      in(col: string, vals: unknown[]) {
        inFilters.push({ col, vals });
        return b;
      },
      order() {
        return b;
      },
      limit() {
        return b;
      },
      single() {
        single = true;
        return b;
      },
      insert(v: Row) {
        (state.tables[table] ??= []).push(structuredClone(v));
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (value: unknown) => void) {
        let rows = state.tables[table] ?? [];
        for (const f of filters) rows = rows.filter((row) => row[f.col] === f.val);
        for (const f of inFilters) rows = rows.filter((row) => (f.vals as unknown[]).includes(row[f.col]));
        const data = single ? (rows[0] ?? null) : rows;
        resolve({
          data,
          error: single && !rows.length ? { message: "no rows" } : null,
        });
      },
    };
    return b;
  }

  return {
    state,
    from: (t: string) => {
      state.fromLog.push(t);
      return builder(t);
    },
    reset(tables: Record<string, Row[]>, user: { id: string } | null, isAdmin: boolean) {
      state.tables = structuredClone(tables);
      state.user = user;
      state.isAdmin = isAdmin;
      state.fromLog = [];
    },
  };
});

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => null }));
vi.mock("@/lib/requestAuth", () => ({
  getRequestAuthContext: async () => ({ user: h.state.user, isAdmin: h.state.isAdmin }),
}));
vi.mock("@/lib/backend/server", () => ({ createServiceClient: () => ({ from: h.from }) }));
vi.mock("@/lib/publicCorpusMetrics", () => ({ invalidatePublicCorpusMetrics: vi.fn() }));

const { POST } = await import("./route");

function jsonRequest(): Request {
  return new Request("http://localhost/api/corpus/import", { method: "POST" });
}

function debate(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, user_id: `u-${id}`, topic_id: `t-${id}`, side: "for", status: "completed", ...overrides };
}

function turns(debateId: string): Record<string, unknown>[] {
  return [1, 2].map((round) => ({
    debate_id: debateId,
    round_number: round,
    user_message: `user argument for ${debateId} round ${round}`,
    ai_message: `ai argument for ${debateId} round ${round}`,
  }));
}

const baseTables = (n: number) => ({
  solo_debates: Array.from({ length: n }, (_, i) => debate(`s${i + 1}`)),
  solo_debate_turns: Array.from({ length: n }, (_, i) => turns(`s${i + 1}`)).flat(),
  profiles: Array.from({ length: n }, (_, i) => ({ id: `u-s${i + 1}`, level: 3 })),
  daily_topics: Array.from({ length: n }, (_, i) => ({
    id: `t-s${i + 1}`,
    category: "economics",
    title: `Topic ${i + 1}`,
    prompt: "Motion text",
  })),
});

describe("POST /api/corpus/import", () => {
  beforeEach(() => {
    h.reset({}, { id: "admin" }, true);
  });

  it("imports a pending solo debate end to end with batched metadata lookups", async () => {
    h.reset(
      {
        solo_debates: [debate("s1")],
        solo_debate_turns: turns("s1"),
        profiles: [{ id: "u-s1", level: 3 }],
        daily_topics: [{ id: "t-s1", category: "economics", title: "Topic 1", prompt: "Motion text" }],
      },
      { id: "admin" },
      true,
    );
    const response = await POST(jsonRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { imported: number; errors: string[] };
    expect(body).toEqual({ imported: 1, errors: [] });
    // Insert records the contributor for exclusion and the topic identity.
    const items = h.state.tables.corpus_items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0].contributor_id).toBe("u-s1");
    expect(items[0].topic_title).toBe("Topic 1");
    expect(items[0].ability_band).toBe("novice");
  });

  it("keeps list reads constant per run as pending debates grow (no per-debate metadata queries)", async () => {
    const listReads = (n: number) => {
      h.reset(baseTables(n), { id: "admin" }, true);
      return POST(jsonRequest()).then(() => h.state.fromLog.filter((t) => t !== "corpus_items").length);
    };
    const small = await listReads(3);
    const large = await listReads(30);
    // solo_debates + pvp_matches + profiles + daily_topics = 4 list reads,
    // plus the genuinely per-debate turns reads (n solo debates). No
    // profiles/daily_topics reads may appear per debate.
    expect(small).toBe(4 + 3);
    expect(large).toBe(4 + 30);
    const metadataReads = (log: string[]) => log.filter((t) => t === "profiles" || t === "daily_topics").length;
    expect(metadataReads(h.state.fromLog)).toBe(2);
  });

  it("never re-imports an already-imported debate and still stays within the query budget", async () => {
    h.reset(baseTables(3), { id: "admin" }, true);
    h.state.tables.corpus_items = h.state.tables.solo_debates!.map((d) => ({
      source_type: "solo",
      source_id: d.id,
    }));
    const response = await POST(jsonRequest());
    const body = (await response.json()) as { imported: number };
    expect(body.imported).toBe(0);
    expect(h.state.fromLog.filter((t) => t === "solo_debate_turns")).toHaveLength(0);
  });

  it("skips debates with too little transcript rather than importing thin rows", async () => {
    h.reset(
      {
        solo_debates: [debate("thin")],
        solo_debate_turns: [
          { debate_id: "thin", round_number: 1, user_message: "one line", ai_message: "ai reply" },
        ],
        profiles: [{ id: "u-thin", level: 2 }],
        daily_topics: [{ id: "t-thin", category: "law", title: "T", prompt: "P" }],
      },
      { id: "admin" },
      true,
    );
    const response = await POST(jsonRequest());
    const body = (await response.json()) as { imported: number };
    expect(body.imported).toBe(0);
    expect(h.state.tables.corpus_items ?? []).toHaveLength(0);
  });
});
