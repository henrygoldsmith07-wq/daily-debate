// Request-time write-once semantics for getTodayTopic (items 4-6, 30).
//
// Production races, reproduced deterministically against a stateful double of
// the query builder that implements the SAME contract as insertIgnore():
//   INSERT ... ON CONFLICT (topic_date) DO NOTHING RETURNING *
//   -> row returned          : this caller won the date
//   -> zero rows, no error   : another writer won; re-read the winner
//   -> error                 : write path unavailable (in-memory fallback)
//
// The regressions pinned here:
//   1. two requests that both see "no topic" converge on ONE stored row —
//      the loser re-reads the winner, no in-memory divergence;
//   2. a scheduled topic that lands between a request's read and write WINS:
//      the request-time fallback re-reads and returns the scheduled row;
//   3. every persisted request-time row carries the full canonical shape
//      (topic_date, title, prompt, category, sources, generation_source,
//      generation_reason, topic_fingerprint);
//   4. an unavailable store serves the in-memory fallback WITHOUT writing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickFallbackExcluding } from "./topicFallbacks";
import { topicFingerprint } from "../../scripts/generate-topics.mjs";

type Row = Record<string, unknown>;

interface GatedRead {
  snapshot: Row | null;
  resolve: (row: Row | null) => void;
}

interface FakeStore {
  rows: Map<string, Row>;
  writes: Row[];
  nextId: number;
  failReads: boolean;
  gateCount: number;
  gated: GatedRead[];
}

function makeStore(): FakeStore {
  return { rows: new Map(), writes: [], nextId: 1, failReads: false, gateCount: 0, gated: [] };
}

function releaseGates(store: FakeStore): void {
  const gated = store.gated.splice(0);
  for (const g of gated) g.resolve(g.snapshot);
}

/** Await until `n` point-reads have captured their (pre-write) snapshot.
 *  The builder is a thenable, so its execute() runs in a microtask AFTER the
 *  caller resumes — releasing before the snapshot exists would release a
 *  nothing and deadlock the gated read. */
async function awaitGated(store: FakeStore, n: number): Promise<void> {
  for (let i = 0; i < 200 && store.gated.length < n; i += 1) await Promise.resolve();
  expect(store.gated.length).toBe(n);
}

/**
 * Minimal chain implementing exactly the surface dailyTopic.ts uses.
 * Point-reads (eq topic_date + maybeSingle) honour the gate: their snapshot
 * is captured AT CALL TIME and handed back on release, which reproduces a
 * read that observed the table before a concurrent writer landed.
 */
function makeClient(store: FakeStore) {
  function from(table: string) {
    if (table !== "daily_topics") throw new Error(`unexpected table: ${table}`);
    let op: "select" | "insertIgnore" = "select";
    let payload: Row | null = null;
    let dateFilter: string | null = null;
    let maybe = false;
    let limit: number | null = null;
    let order: string | null = null;

    const execute = async (): Promise<{ data: unknown; error: { message: string } | null }> => {
      if (store.failReads) throw new Error("store unavailable (connection refused)");
      if (op === "insertIgnore") {
        const row = payload as Row;
        store.writes.push({ ...row });
        const date = String(row.topic_date);
        if (store.rows.has(date)) {
          // ON CONFLICT (topic_date) DO NOTHING -> zero rows, NO error.
          return { data: null, error: null };
        }
        const stored = { id: store.nextId++, ...row };
        store.rows.set(date, stored);
        return { data: { ...stored }, error: null };
      }
      if (dateFilter !== null) {
        const snapshot = store.rows.get(dateFilter) ?? null;
        if (store.gateCount > 0) {
          store.gateCount -= 1;
          return await new Promise((resolve) => {
            store.gated.push({ snapshot, resolve: (row) => resolve({ data: row ? { ...row } : null, error: null }) });
          });
        }
        return { data: snapshot ? { ...snapshot } : null, error: null };
      }
      // unbounded select("title") for recent titles
      let list = [...store.rows.values()].map((r) => ({ title: r.title }));
      if (order === "topic_date:desc") list = list.slice().reverse();
      if (limit !== null) list = list.slice(0, limit);
      return { data: list, error: null };
    };

    const chain = {
      select() {
        return chain;
      },
      insertIgnore(row: Row) {
        op = "insertIgnore";
        payload = row;
        return chain;
      },
      eq(column: string, value: unknown) {
        if (column !== "topic_date") throw new Error(`unexpected filter: ${column}`);
        dateFilter = String(value);
        return chain;
      },
      order(column: string) {
        order = `${column}:desc`;
        return chain;
      },
      limit(n: number) {
        limit = n;
        return chain;
      },
      maybeSingle() {
        maybe = true;
        return chain;
      },
      then<A, B>(
        onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null,
        onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
      ): PromiseLike<A | B> {
        void maybe;
        return execute().then(onfulfilled, onrejected);
      },
    };
    return chain;
  }
  return { from };
}

const holder = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof makeClient> }));
vi.mock("./backend/server", () => ({
  createServiceClient: () => holder.client,
}));

import { getTodayTopic, getOrCreateTodayTopic } from "./dailyTopic";

const DATE = "2099-01-15"; // far future: never collides with real rows (double only anyway)

describe("request-time write-once (getTodayTopic)", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = makeStore();
    holder.client = makeClient(store);
    // The double is keyed by whatever date the runtime computes; pin the
    // clock so every read/write addresses DATE.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${DATE}T12:00:00Z`));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("converges two concurrent requests on ONE stored row (loser re-reads the winner)", async () => {
    store.gateCount = 2; // both callers observe the table before either writes

    const first = getTodayTopic();
    const second = getTodayTopic();
    await awaitGated(store, 2);
    releaseGates(store);
    const [a, b] = await Promise.all([first, second]);

    expect(store.rows.size).toBe(1); // exactly one DB row
    expect(store.writes.length).toBe(2); // both ATTEMPTED the claim...
    const stored = store.rows.get(DATE)!;
    // ...but both callers return THE stored row: same id, same fingerprint,
    // and the loser's result is the re-read winner (it carries the id only
    // the successful insert produces), never an in-memory topic.
    expect(a.id).toBe(stored.id);
    expect(b.id).toBe(stored.id);
    expect(a.id).not.toBe("fallback-in-memory");
    expect(b.id).not.toBe("fallback-in-memory");
    expect(a.title).toBe(b.title);
    expect(a.topic_fingerprint).toBe(b.topic_fingerprint);
    expect(a.topic_fingerprint).toBe(
      topicFingerprint({ topicDate: DATE, title: String(stored.title), prompt: String(stored.prompt), category: String(stored.category) }),
    );
  });

  it("scheduled topic wins the race against a request-time fallback", async () => {
    const scheduled = {
      id: 77,
      topic_date: DATE,
      title: "Scheduled winner topic",
      prompt: "A scheduled prompt that must survive the request-time race?",
      category: "Policy",
      sources: [{ name: "NREL", homepage: "https://nrel.gov" }],
      generation_source: "ai",
      generation_reason: "ai",
      topic_fingerprint: topicFingerprint({
        topicDate: DATE,
        title: "Scheduled winner topic",
        prompt: "A scheduled prompt that must survive the request-time race?",
        category: "Policy",
      }),
      created_at: "2099-01-14T20:00:00Z",
    };

    store.gateCount = 1;
    const pending = getTodayTopic();
    await awaitGated(store, 1); // the request's read has snapshot an empty table
    // The scheduled pipeline lands between this request's read and its write.
    store.rows.set(DATE, scheduled as Row);
    releaseGates(store); // the request resumes with its STALE miss
    const got = await pending;

    const stored = store.rows.get(DATE)!;
    expect(got.title).toBe("Scheduled winner topic"); // re-read the winner, not the fallback
    expect(got.topic_fingerprint).toBe(scheduled.topic_fingerprint);
    expect(got.generation_source).toBe("ai");
    expect(store.rows.size).toBe(1);
    expect(stored.generation_reason).toBe("ai"); // the fallback never overwrote provenance
    expect(store.writes.length).toBe(1); // claim attempted, conflict ignored
  });

  it("persists the full canonical shape (fingerprint + reason) and serves it back", async () => {
    const got = await getTodayTopic();

    expect(store.writes.length).toBe(1);
    const write = store.writes[0];
    for (const column of [
      "topic_date",
      "title",
      "prompt",
      "category",
      "sources",
      "generation_source",
      "generation_reason",
      "topic_fingerprint",
    ]) {
      expect(write[column], `canonical column ${column}`).toBeDefined();
    }
    expect(write.topic_date).toBe(DATE);
    expect(write.generation_source).toBe("fallback");
    expect(write.generation_reason).toBe("request-time-fallback");
    expect(String(write.topic_fingerprint)).toMatch(/^[0-9a-f]{64}$/);
    expect(write.topic_fingerprint).toBe(
      topicFingerprint({
        topicDate: DATE,
        title: String(write.title),
        prompt: String(write.prompt),
        category: String(write.category),
      }),
    );
    // The served topic IS the stored row (not the in-memory copy).
    expect(got.id).toBe(store.rows.get(DATE)!.id);
    // And it is the fallback the date's exclusion picker would choose.
    expect(write.title).toBe(pickFallbackExcluding(DATE, []).title);
  });

  it("serves the in-memory fallback WITHOUT writing when the store is unavailable", async () => {
    store.failReads = true;
    const got = await getTodayTopic();

    expect(got.id).toBe("fallback-in-memory");
    expect(got.topic_date).toBe(DATE);
    expect(got.title).toBeTruthy();
    expect(store.writes.length).toBe(0); // availability protection only: no DB write
    expect(store.rows.size).toBe(0);
  });

  it("keeps the legacy alias pointing at the same implementation", () => {
    expect(getOrCreateTodayTopic).toBe(getTodayTopic);
  });
});
