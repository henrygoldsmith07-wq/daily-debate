import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkConfig,
  modelTimeoutMs,
  pickFallback,
  resolveTargetDate,
  runGeneration,
  scoreCandidate,
  scoreNovelty,
  timeoutForAttempt,
  topicFingerprint,
  topicRowStatus,
} from "../../scripts/generate-topics.mjs";

/**
 * TOPIC-GENERATION PIPELINE SMOKE TESTS.
 *
 * The scheduled generator must fail loudly on misconfiguration (never a
 * silent break), stay deterministic in fallback selection, and keep its
 * storage path idempotent. Provider/DB live paths are exercised by the
 * workflow itself; these tests pin the offline-verifiable contract.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(projectRoot, "scripts", "generate-topics.mjs");

function runScript(args: string[], env: Record<string, string | undefined>): { stdout: string; stderr: string; status: number } {
  const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ["DATABASE_URL", "NVIDIA_API_KEY", "OPENROUTER_API_KEY", "UNOROUTER_API_KEY", "KIRAAI_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_FALLBACK_MODELS", "ANTHROPIC_API_KEY"]) {
    delete cleanEnv[k];
  }
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) cleanEnv[k] = v;
  }
  try {
    const stdout = execFileSync("node", [script, ...args], {
      env: cleanEnv,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    }) as unknown as string;
    return { stdout, stderr: "", status: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: unknown; stderr?: unknown; status?: unknown };
    return {
      stdout: typeof err.stdout === "string" ? err.stdout : "",
      stderr: typeof err.stderr === "string" ? err.stderr : "",
      status: typeof err.status === "number" ? err.status : 1,
    };
  }
}

describe("generate-topics CLI contract", () => {
  it("--help exits 0 without touching config", () => {
    const r = runScript(["--help"], {});
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--check-config");
  });

  it("missing DATABASE_URL fails fast as config-failure (no silent break)", () => {
    const r = runScript(["--check-config"], {});
    expect(r.status).toBe(1);
    const combined = r.stdout + r.stderr;
    expect(combined).toMatch(/config-failure/i);
    expect(combined).toMatch(/DATABASE_URL/);
    // Secret values must never appear in output.
    expect(combined).not.toMatch(/password|secret|token|key=[A-Za-z0-9]/i);
  });

  it("unreachable DATABASE_URL fails fast as db-failure, not config-failure", () => {
    const r = runScript(["--check-config"], { DATABASE_URL: "postgresql://u:p@127.0.0.1:1/db" });
    expect(r.status).toBe(1);
    const combined = r.stdout + r.stderr;
    expect(combined).toMatch(/db-failure/i);
    // Host is logged for diagnosis; credentials are not.
    expect(combined).toMatch(/127\.0\.0\.1/);
    expect(combined).not.toContain("u:p@");
  });

  it("bare run without DATABASE_URL exits non-zero with an explicit outcome", () => {
    const r = runScript([], {});
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/outcome=config-failure/);
  });

  it("missing migration 018 fails the config gate BEFORE any generation attempt", async () => {
    // Fake executor: reachable DB, required tables present, unique constraint
    // present — but NO topic_fingerprint columns anywhere (018 unapplied).
    const sqlFactory = async () => async (text: string) => {
      const q = text.replace(/\s+/g, " ").trim();
      if (/^SELECT 1$/i.test(q)) return [];
      if (/information_schema\.tables/i.test(q)) return [{ table_name: "daily_topics" }, { table_name: "topic_evidence" }];
      if (/table_constraints/i.test(q)) return [{ ok: 1 }];
      if (/information_schema\.columns/i.test(q)) return []; // 018 missing
      throw new Error(`unexpected: ${q.slice(0, 60)}`);
    };
    const result = await checkConfig({ DATABASE_URL: "postgres://fake" } as unknown as NodeJS.ProcessEnv, sqlFactory);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/fingerprint schema missing/i);
    expect(result.reason).toMatch(/migrations/i);
    expect(result.checks.topic_fingerprint_supported).toBe(false);
  });

  it("a fully migrated database passes the config gate", async () => {
    const sqlFactory = async () => async (text: string) => {
      const q = text.replace(/\s+/g, " ").trim();
      if (/^SELECT 1$/i.test(q)) return [];
      if (/information_schema\.tables/i.test(q)) return [{ table_name: "daily_topics" }, { table_name: "topic_evidence" }];
      if (/table_constraints/i.test(q)) return [{ ok: 1 }];
      if (/information_schema\.columns/i.test(q)) {
        return [{ table_name: "daily_topics" }, { table_name: "topic_evidence" }, { table_name: "topic_run_log" }];
      }
      throw new Error(`unexpected: ${q.slice(0, 60)}`);
    };
    const result = await checkConfig({ DATABASE_URL: "postgres://fake" } as unknown as NodeJS.ProcessEnv, sqlFactory);
    expect(result.ok).toBe(true);
    expect(result.checks.topic_fingerprint_supported).toBe(true);
  });
});

describe("curated fallback selection", () => {
  it("is deterministic for the same date and history", () => {
    const recent = ["Solar costs keep falling worldwide"];
    expect(pickFallback("2026-09-11", recent)).toEqual(pickFallback("2026-09-11", recent));
  });

  it("avoids repeating recent titles (at most one shared content word)", () => {
    const recent = ["Cities should eliminate minimum parking requirements for new developments"];
    const picked = pickFallback("2026-09-11", recent);
    expect(picked.title).not.toBe(recent[0]);
  });

  it("always returns a usable topic shape", () => {
    for (const date of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
      const picked = pickFallback(date, []);
      expect(picked.title.length).toBeGreaterThan(10);
      expect(picked.prompt.length).toBeGreaterThan(20);
      expect(picked.category.length).toBeGreaterThan(0);
    }
  });
});

describe("candidate scoring", () => {
  const candidate = {
    title: "Cities should eliminate minimum parking requirements for new developments",
    prompt: "Should urban planning rules stop requiring developers to build parking spaces alongside new housing? Studies of parking costs inform the trade-off.",
    category: "Policy",
    sources: [],
  };

  it("ranks a balanced, specific, evidence-rich candidate above a vague one", () => {
    const good = scoreCandidate(candidate, []);
    const bad = scoreCandidate(
      { title: "Stuff", prompt: "Everyone knows this is clearly bad without question.", category: "Misc", sources: [] },
      [],
    );
    expect(good._score).toBeGreaterThan(bad._score);
  });

  it("penalises heavy overlap with recent titles", () => {
    const fresh = scoreNovelty(candidate.title, ["Unrelated transit funding debate"]);
    const stale = scoreNovelty(candidate.title, [candidate.title]);
    expect(fresh).toBeGreaterThan(stale);
    expect(stale).toBe(0);
  });
});

/**
 * PIPELINE INTEGRATION — runGeneration against in-memory query doubles that
 * emulate production SQL semantics: write-once INSERT ... ON CONFLICT DO
 * NOTHING (concurrent retries converge), fingerprint columns (migration
 * 018), and optionally strict jsonb binding. Proves the write path end to
 * end (topic + evidence + provenance + fingerprint) and, crucially, that an
 * immediate re-run for the SAME target date VERIFIES rather than replaces:
 * same row, same fingerprint, same evidence, same provenance.
 */
type Row = Record<string, unknown>;
interface FakeDbOpts {
  jsonbStrict?: boolean;
  legacySchema?: boolean;
}
interface Fake {
  topics: Map<string, Row & { id: number }>;
  evidence: Row[];
  queries: string[];
  query: (text: string, params?: unknown[]) => Promise<Row[]>;
}
function fakeDb(opts: FakeDbOpts = {}): Fake {
  const topics = new Map<string, Row & { id: number }>();
  const evidence: Row[] = [];
  const queries: string[] = [];
  let seq = 0;
  const asJsonb = (value: unknown, column: string): unknown => {
    if (!opts.jsonbStrict) return value;
    if (typeof value !== "string") throw new Error(`invalid input syntax for type json (${column})`);
    JSON.parse(value);
    return value;
  };
  const query = async (text: string, params: unknown[] = []): Promise<Row[]> => {
    const sql = text.replace(/\s+/g, " ").trim();
    queries.push(sql.slice(0, 60));
    if (/^(BEGIN|COMMIT|ROLLBACK);?$/.test(sql)) return []; // transactional control statements
    if (/^SELECT column_name FROM information_schema/i.test(sql)) {
      if (opts.legacySchema) return [];
      const col = /column_name = '([a-z_]+)'/.exec(sql)?.[1] ?? "topic_fingerprint";
      return [{ column_name: col }];
    }
    if (/^SELECT title FROM daily_topics/i.test(sql)) {
      return [...topics.values()].map((r) => ({ title: r.title }));
    }
    if (/^SELECT .* FROM daily_topics WHERE topic_date/i.test(sql)) {
      const [date] = params as [string];
      const row = topics.get(date);
      return row ? [{ ...row }] : [];
    }
    if (/^INSERT INTO daily_topics/i.test(sql)) {
      const [date, title, prompt, category, sources, source, fingerprint] = params as [
        string, string, string, string, unknown, string, string?,
      ];
      asJsonb(sources, "daily_topics.sources");
      if (topics.has(date)) return []; // ON CONFLICT DO NOTHING: first writer wins
      const row = {
        id: ++seq, topic_date: date, title, prompt, category, sources,
        generation_source: source, topic_fingerprint: fingerprint ?? null,
      } as Row & { id: number };
      topics.set(date, row);
      return [{ id: row.id }];
    }
    if (/^UPDATE daily_topics SET title/i.test(sql)) {
      const [date, title, prompt, category, sources, source, fingerprint] = params as [
        string, string, string, string, unknown, string, string?,
      ];
      const row = topics.get(date);
      if (!row) return [];
      Object.assign(row, { title, prompt, category, sources: asJsonb(sources, "daily_topics.sources"), generation_source: source });
      if (fingerprint !== undefined) row.topic_fingerprint = fingerprint;
      return [{ id: row.id }];
    }
    if (/^UPDATE daily_topics SET topic_fingerprint/i.test(sql)) {
      const [id, fp] = params as [number, string];
      for (const row of topics.values()) if (row.id === id) row.topic_fingerprint = fp;
      return [];
    }
    if (/^DELETE FROM topic_evidence WHERE topic_id = \$1 AND topic_fingerprint/i.test(sql)) {
      const [topicId, fp] = params as [number, string];
      // Mirrors production `IS DISTINCT FROM`: mismatched AND unstamped
      // (legacy NULL) rows are deleted — untrusted evidence is never kept.
      for (let i = evidence.length - 1; i >= 0; i--) {
        if (evidence[i].topic_id === topicId && evidence[i].topic_fingerprint !== fp) {
          evidence.splice(i, 1);
        }
      }
      return [];
    }
    if (/^DELETE FROM topic_evidence WHERE topic_id/i.test(sql)) {
      const [topicId] = params as [number];
      for (let i = evidence.length - 1; i >= 0; i--) if (evidence[i].topic_id === topicId) evidence.splice(i, 1);
      return [];
    }
    if (/^INSERT INTO topic_evidence/i.test(sql)) {
      const hasFp = /topic_fingerprint/i.test(sql);
      const [topicId, claim, sourceName, sourceType, url, title, passage, publishedDate, checks, fp] = params as unknown[];
      asJsonb(checks, "topic_evidence.checks");
      evidence.push({
        topic_id: topicId, claim, source_name: sourceName, source_type: sourceType, url,
        title, passage, published_date: publishedDate, checks,
        topic_fingerprint: hasFp ? (fp as string) : null,
      });
      return [];
    }
    if (/^SELECT count\(\*\)::int AS total/i.test(sql)) {
      const [topicId, fp] = params as [number, string?];
      const rows = evidence.filter((c) => c.topic_id === topicId);
      return [{
        total: rows.length,
        mismatched: rows.filter((c) => c.topic_fingerprint != null && c.topic_fingerprint !== fp).length,
        unstamped: rows.filter((c) => c.topic_fingerprint == null).length,
      }];
    }
    throw new Error(`unexpected SQL: ${text.slice(0, 80)}`);
  };
  return { topics, evidence, queries, query };
}

describe("runGeneration pipeline (injected query)", () => {
  const NOW = new Date("2026-09-11T02:00:00Z");
  const stubRetrieve = async () => [
    { claim: "c", sourceName: "NREL", sourceType: "primary", url: "https://nrel.gov", passage: "p" },
    { claim: "c", sourceName: "Pew", sourceType: "secondary", url: "https://pewresearch.org", passage: "q" },
  ];
  const silent = { log: () => {} } as const;

  it("curated fallback path stores exactly one topic + evidence with fallback provenance", async () => {
    const db = fakeDb();
    const result = await runGeneration({ query: db.query, env: {}, retrieve: stubRetrieve, now: NOW, ...silent });
    expect(result.outcome).toBe("curated-fallback");
    expect(result.source).toBe("fallback");
    expect(db.topics.size).toBe(1);
    expect([...db.topics.values()][0].generation_source).toBe("fallback");
    expect(db.evidence).toHaveLength(2);
    expect(typeof result.fingerprint).toBe("string");
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a same-date retry cannot change the topic: already-present with identical fingerprint", async () => {
    const db = fakeDb();
    const first = await runGeneration({ query: db.query, env: {}, retrieve: stubRetrieve, now: NOW, ...silent });
    const second = await runGeneration({ query: db.query, env: {}, retrieve: stubRetrieve, now: NOW, ...silent });
    expect(second.outcome).toBe("already-present");
    expect(second.date).toBe(first.date);
    expect(second.title).toBe(first.title);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(db.topics.size).toBe(1); // write-once, not a second row
    expect(db.evidence).toHaveLength(2); // verified, never doubled
    const rows = [...db.topics.values()];
    expect(new Set(rows.map((r) => r.generation_source)).size).toBe(1); // consistent provenance
    expect(rows[0].generation_source).toBe(second.source);
  });

  it("a third retry remains identical", async () => {
    const db = fakeDb();
    const first = await runGeneration({ query: db.query, env: {}, retrieve: stubRetrieve, now: NOW, ...silent });
    await runGeneration({ query: db.query, env: {}, retrieve: stubRetrieve, now: NOW, ...silent });
    const third = await runGeneration({ query: db.query, env: {}, retrieve: stubRetrieve, now: NOW, ...silent });
    expect(third.outcome).toBe("already-present");
    expect(third.fingerprint).toBe(first.fingerprint);
    expect(third.title).toBe(first.title);
    expect(db.topics.size).toBe(1);
    expect(db.evidence).toHaveLength(2);
  });

  it("re-running immediately is idempotent: no duplicate topic, no duplicate evidence", async () => {
    const db = fakeDb();
    const first = await runGeneration({ query: db.query, env: {}, retrieve: stubRetrieve, now: NOW, ...silent });
    const second = await runGeneration({ query: db.query, env: {}, retrieve: stubRetrieve, now: NOW, ...silent });
    expect(second.date).toBe(first.date);
    expect(db.topics.size).toBe(1); // ON CONFLICT, not a second row
    expect(db.evidence).toHaveLength(2); // replaced, never doubled
    const rows = [...db.topics.values()];
    expect(new Set(rows.map((r) => r.generation_source)).size).toBe(1); // consistent provenance
    expect(rows[0].generation_source).toBe(second.source);
  });

  it("AI success stores ai provenance", async () => {
    const db = fakeDb();
    const generate = async () => [
      { title: "Cities should eliminate minimum parking requirements", prompt: "Should planning rules stop requiring parking?", category: "Policy", sources: [] },
    ];
    const result = await runGeneration({ query: db.query, env: { NVIDIA_API_KEY: "x" }, generate, retrieve: async () => [], now: NOW, ...silent });
    expect(result.outcome).toBe("ai-generated");
    expect([...db.topics.values()][0].generation_source).toBe("ai");
  });

  it("AI provider failure falls back to curated and still writes a valid topic", async () => {
    const db = fakeDb();
    const generate = async () => { throw new Error("429 rate limited"); };
    const result = await runGeneration({ query: db.query, env: { NVIDIA_API_KEY: "x" }, generate, retrieve: stubRetrieve, now: NOW, ...silent });
    expect(result.outcome).toBe("provider-failure");
    expect(result.source).toBe("fallback");
    expect(db.topics.size).toBe(1);
    expect([...db.topics.values()][0].generation_source).toBe("fallback");
  });

  it("a DB write failure surfaces as db-failure, never a silent success", async () => {
    const db = fakeDb();
    const query = async (text: string) => {
      if (/^INSERT INTO daily_topics/i.test(text)) throw new Error("connection reset");
      return db.query(text);
    };
    const result = await runGeneration({ query, env: {}, retrieve: async () => [], now: NOW, ...silent });
    expect(result.outcome).toBe("db-failure");
    expect(result.stage).toBe("store-topic");
  });

  it("evidence retrieval failure is non-destructive: the topic still stands", async () => {
    const db = fakeDb();
    const retrieve = async () => { throw new Error("network down"); };
    const result = await runGeneration({ query: db.query, env: {}, retrieve, now: NOW, ...silent });
    expect(result.outcome).toBe("curated-fallback");
    expect(result.evidenceCards).toBe(0);
    expect(db.topics.size).toBe(1);
  });

  it("a 23:40 slot that slips past midnight still targets the same date (recovery, not next cycle)", async () => {
    const db = fakeDb();
    const onTime = await runGeneration({ query: db.query, env: {}, retrieve: async () => [], now: new Date("2026-09-16T23:40:00Z"), ...silent });
    const late = await runGeneration({ query: db.query, env: {}, retrieve: async () => [], now: new Date("2026-09-17T00:55:00Z"), ...silent });
    expect(onTime.date).toBe("2026-09-17");
    // The delayed rerun must land on the SAME row (idempotent recovery),
    // never silently advance to the next cycle's date.
    expect(late.date).toBe("2026-09-17");
    expect(late.outcome).toBe("already-present");
    expect(late.fingerprint).toBe(onTime.fingerprint);
    expect(db.topics.size).toBe(1);
  });
});

/**
 * IMMUTABLE AI TOPICS + CONCURRENT RETRIES.
 *
 * A user must never see two different "daily topics" for the same date
 * because the scheduler retried: the first valid write wins, every later
 * run verifies it, and concurrent same-date runs converge on one row with
 * one fingerprint.
 */
describe("immutable retries and concurrent convergence", () => {
  const NOW = new Date("2026-09-11T02:00:00Z");
  const silent = { log: () => {} } as const;
  const aiTopic = {
    title: "Cities should eliminate minimum parking requirements",
    prompt: "Should planning rules stop requiring parking?",
    category: "Policy",
    sources: [{ name: "NREL", homepage: "https://www.nrel.gov", angle: "housing costs" }],
  };
  const stubRetrieve = async () => [
    { claim: "c", sourceName: "NREL", sourceType: "primary", url: "https://nrel.gov", passage: "p" },
  ];

  it("first run creates an AI topic; the second returns already-present with the same fingerprint", async () => {
    const db = fakeDb();
    const generate = async () => [{ ...aiTopic }];
    const first = await runGeneration({ query: db.query, env: { NVIDIA_API_KEY: "x" }, generate, retrieve: stubRetrieve, now: NOW, ...silent });
    expect(first.outcome).toBe("ai-generated");
    expect(first.source).toBe("ai");
    const second = await runGeneration({ query: db.query, env: { NVIDIA_API_KEY: "x" }, generate, retrieve: stubRetrieve, now: NOW, ...silent });
    expect(second.outcome).toBe("already-present");
    expect(second.source).toBe("ai");
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.title).toBe(first.title);
    expect(second.evidenceCards).toBe(first.evidenceCards);
    expect(db.topics.size).toBe(1);
    expect(db.evidence).toHaveLength(1);
    expect(db.evidence[0].topic_fingerprint).toBe(first.fingerprint);
  });

  it("concurrent same-date runs converge on one immutable topic", async () => {
    const db = fakeDb();
    const generate = async () => [{ ...aiTopic }];
    const opts = { query: db.query, env: { NVIDIA_API_KEY: "x" }, generate, retrieve: stubRetrieve, now: NOW, ...silent };
    const [a, b] = await Promise.all([runGeneration(opts), runGeneration(opts)]);
    expect(db.topics.size).toBe(1);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.title).toBe(b.title);
    // Exactly one writer; the loser converged instead of replacing.
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["ai-generated", "already-present"]);
    expect(db.evidence).toHaveLength(1);
  });

  it("legacy NULL evidence is deleted and rebuilt, never stamped (stale-production regression)", async () => {
    // The exact production failure this pins: Topic A ("Space debris...")
    // stored with Evidence A; the row was later OVERWRITTEN with Topic B
    // ("Carbon border tariffs..."); the new retrieval returned 0, so
    // Evidence A SURVIVED attached to Topic B. After migration 018 the row
    // and the stale cards both carry NULL fingerprints. Healing must
    // preserve Topic B's content, stamp its canonical fingerprint, DELETE
    // the unknown-revision cards (not launder them by stamping), and rebuild
    // evidence for Topic B — even when that means zero evidence.
    const db = fakeDb();
    const target = "2026-09-11";
    db.topics.set(target, {
      id: 1, topic_date: target,
      title: "Carbon border tariffs should apply to imports from countries with weaker climate policies",
      prompt: "Would carbon-border tariffs accelerate global emissions reduction or protect domestic industry?",
      category: "Environment", sources: "[]", generation_source: "ai", topic_fingerprint: null,
    });
    db.evidence.push(
      { topic_id: 1, claim: "Space debris deorbit requirement", source_name: "NREL", url: "https://nrel.gov/legacy-a", topic_fingerprint: null },
      { topic_id: 1, claim: "Orbital debris mitigation cost", source_name: "Pew", url: "https://pewresearch.org/legacy-a2", topic_fingerprint: null },
    );
    const result = await runGeneration({ query: db.query, env: {}, retrieve: async () => [], now: NOW, ...silent });
    expect(result.outcome).toBe("already-present");
    expect(result.repaired).toBe("rebuild-legacy-evidence");
    // Topic B unchanged and now canonically fingerprinted.
    const row = [...db.topics.values()][0];
    expect(result.title).toBe(row.title);
    expect(row.title).toMatch(/Carbon border tariffs/);
    expect(row.generation_source).toBe("ai");
    expect(row.topic_fingerprint).toBe(result.fingerprint);
    // Evidence A is gone, NOT stamped; retrieval returned nothing, so zero
    // evidence is the honest retained outcome.
    expect(db.evidence).toHaveLength(0);
  });

  it("legacy healing rebuilds evidence for the CURRENT topic, all stamped with its fingerprint", async () => {
    const db = fakeDb();
    const target = "2026-09-11";
    db.topics.set(target, {
      id: 1, topic_date: target,
      title: "Carbon border tariffs should apply to imports from countries with weaker climate policies",
      prompt: "Would carbon-border tariffs accelerate global emissions reduction or protect domestic industry?",
      category: "Environment", sources: "[]", generation_source: "ai", topic_fingerprint: null,
    });
    db.evidence.push(
      { topic_id: 1, claim: "Space debris deorbit requirement", source_name: "NREL", url: "https://nrel.gov/legacy-a", topic_fingerprint: null },
    );
    const rebuilt = await runGeneration({ query: db.query, env: {}, retrieve: stubRetrieve, now: NOW, ...silent });
    expect(rebuilt.outcome).toBe("already-present");
    expect(rebuilt.repaired).toBe("rebuild-legacy-evidence");
    // Exactly the freshly retrieved cards survive — the legacy card does not.
    expect(db.evidence).toHaveLength(1);
    expect(db.evidence.every((c) => c.topic_fingerprint === rebuilt.fingerprint)).toBe(true);
    expect(db.evidence.some((c) => c.claim === "Space debris deorbit requirement")).toBe(false);
  });

  it("unstamped cards on an already-fingerprinted topic are deleted and re-retrieved, never stamped", async () => {
    const db = fakeDb();
    const first = await runGeneration({ query: db.query, env: {}, retrieve: stubRetrieve, now: NOW, ...silent });
    const topicId = [...db.topics.values()][0].id;
    // A legacy-style card (NULL fingerprint) appears on a fingerprinted row.
    db.evidence.push({ topic_id: topicId, claim: "pre-018 leftover", source_name: "NREL", url: "https://nrel.gov/leftover", topic_fingerprint: null });
    const second = await runGeneration({ query: db.query, env: {}, retrieve: stubRetrieve, now: NOW, ...silent });
    expect(second.outcome).toBe("already-present");
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.repaired).toBe("removed-unstamped-evidence");
    // The unstamped card was deleted; the re-retrieval rebuilt a clean set.
    expect(db.evidence.every((c) => c.topic_fingerprint === first.fingerprint)).toBe(true);
    expect(db.evidence.some((c) => c.claim === "pre-018 leftover")).toBe(false);
  });

  it("an invalid/corrupt row takes the deliberate repair path, never silent health", async () => {
    const db = fakeDb();
    const target = "2026-09-11";
    db.topics.set(target, {
      id: 1, topic_date: target, title: "", prompt: "", category: "",
      sources: "[]", generation_source: "fallback", topic_fingerprint: "corrupt",
    });
    const generate = async () => [{ ...aiTopic }];
    const result = await runGeneration({ query: db.query, env: { NVIDIA_API_KEY: "x" }, generate, retrieve: stubRetrieve, now: NOW, ...silent });
    expect(result.outcome).toBe("ai-generated");
    expect(result.repaired).toBe("replaced-invalid-row");
    expect(db.topics.size).toBe(1);
    const row = [...db.topics.values()][0];
    expect(row.title).toBe(aiTopic.title);
    expect(row.topic_fingerprint).toBe(result.fingerprint);
  });

  it("a fingerprint mismatch on valid-looking content also repairs deliberately", async () => {
    const db = fakeDb();
    const target = "2026-09-11";
    db.topics.set(target, {
      id: 1, topic_date: target, title: "Tampered title", prompt: "Tampered prompt.", category: "Policy",
      sources: "[]", generation_source: "fallback", topic_fingerprint: "0".repeat(64),
    });
    const generate = async () => [{ ...aiTopic }];
    const result = await runGeneration({ query: db.query, env: { NVIDIA_API_KEY: "x" }, generate, retrieve: stubRetrieve, now: NOW, ...silent });
    expect(result.repaired).toBe("replaced-invalid-row");
    expect([...db.topics.values()][0].topic_fingerprint).toBe(result.fingerprint);
  });
});

/**
 * STALE EVIDENCE CAN NEVER SURVIVE A TOPIC-CONTENT CHANGE.
 *
 * Repro: run 1 stores topic A + evidence A; the stored content is then
 * replaced out-of-band by topic-B content (the corruption the repair path
 * exists for); run 2 regenerates topic B with ZERO retrieved cards. The old
 * code returned early on empty cards and left evidence A attached to topic
 * B. The atomic replace (delete-then-insert, including zero rows) forbids it.
 */
describe("stale evidence elimination", () => {
  const NOW = new Date("2026-09-11T02:00:00Z");
  const silent = { log: () => {} } as const;
  const target = "2026-09-11";

  it("a content change with zero new cards leaves no stale evidence behind", async () => {
    const db = fakeDb();
    const topicA = {
      title: "Topic A should be debated vigorously by everyone",
      prompt: "Should topic A be debated?",
      category: "Policy",
      sources: [],
    };
    const topicB = {
      title: "Topic B deserves a completely different daily debate",
      prompt: "Should topic B replace everything?",
      category: "Science",
      sources: [],
    };
    const evidenceA = async () => [
      { claim: "claim A", sourceName: "NREL", sourceType: "primary", url: "https://nrel.gov/a", passage: "p" },
      { claim: "claim A2", sourceName: "Pew", sourceType: "secondary", url: "https://pewresearch.org/a", passage: "q" },
    ];
    const first = await runGeneration({
      query: db.query, env: { NVIDIA_API_KEY: "x" }, generate: async () => [{ ...topicA }], retrieve: evidenceA, now: NOW, ...silent,
    });
    expect(first.outcome).toBe("ai-generated");
    expect(first.title).toBe(topicA.title);
    expect(db.evidence).toHaveLength(2);

    // Corrupt the stored content out-of-band to topic-B content while the
    // old fingerprint and evidence A remain (the stale state under test).
    const row = db.topics.get(target)!;
    row.title = topicB.title;
    row.prompt = topicB.prompt;
    row.category = topicB.category;

    // Repair regenerates (topic B) with ZERO retrieved cards.
    const generateB = async () => [{ ...topicB }];
    const second = await runGeneration({
      query: db.query, env: { NVIDIA_API_KEY: "x" }, generate: generateB, retrieve: async () => [], now: NOW, ...silent,
    });
    expect(second.repaired).toBe("replaced-invalid-row");
    expect(second.title).toBe(topicB.title);
    expect(db.evidence).toHaveLength(0); // stale evidence A is gone, zero rows stored
    expect(second.evidenceCards).toBe(0);
  });

  it("already-present with empty evidence re-retrieves without changing the topic", async () => {
    const db = fakeDb();
    const topic = {
      title: "A stable topic that keeps its daily slot",
      prompt: "Should stability win?",
      category: "Policy",
      sources: [],
    };
    const first = await runGeneration({
      query: db.query, env: { NVIDIA_API_KEY: "x" }, generate: async () => [{ ...topic }], retrieve: async () => [], now: NOW, ...silent,
    });
    expect(first.outcome).toBe("ai-generated");
    expect(first.evidenceCards).toBe(0);
    const healing = async () => [
      { claim: "c", sourceName: "NREL", sourceType: "primary", url: "https://nrel.gov", passage: "p" },
    ];
    // No provider keys this time: the retry must verify, never regenerate.
    const second = await runGeneration({
      query: db.query, env: {}, generate: async () => { throw new Error("must not be called"); }, retrieve: healing, now: NOW, ...silent,
    });
    expect(second.outcome).toBe("already-present");
    expect(second.title).toBe(first.title);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.evidenceCards).toBe(1);
    expect(db.evidence).toHaveLength(1);
    expect(db.evidence[0].topic_fingerprint).toBe(first.fingerprint);
  });
});

/**
 * CANONICAL TOPIC FINGERPRINT (SHA-256 over version + date + title +
 * prompt + category). The idempotence proof compares these — never bare
 * success counts.
 */
describe("topicFingerprint and topicRowStatus", () => {
  it("is deterministic, content-sensitive and hex-encoded", () => {
    const base = { topicDate: "2026-09-11", title: "T", prompt: "P", category: "C" };
    const fp = topicFingerprint(base);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(topicFingerprint(base)).toBe(fp);
    expect(topicFingerprint({ ...base, title: "T2" })).not.toBe(fp);
    expect(topicFingerprint({ ...base, prompt: "P2" })).not.toBe(fp);
    expect(topicFingerprint({ ...base, category: "C2" })).not.toBe(fp);
    expect(topicFingerprint({ ...base, topicDate: "2026-09-12" })).not.toBe(fp);
  });

  it("classifies stored rows for the write-once gate", () => {
    const good = {
      title: "T", prompt: "P", category: "C", generation_source: "fallback",
      topic_fingerprint: topicFingerprint({ topicDate: "2026-09-11", title: "T", prompt: "P", category: "C" }),
    };
    expect(topicRowStatus(good, "2026-09-11")).toBe("valid");
    expect(topicRowStatus(null, "2026-09-11")).toBe("missing");
    expect(topicRowStatus({ ...good, topic_fingerprint: null }, "2026-09-11")).toBe("legacy-unfingerprinted");
    expect(topicRowStatus({ ...good, title: "" }, "2026-09-11")).toBe("invalid-content");
    expect(topicRowStatus({ ...good, generation_source: "mystery" }, "2026-09-11")).toBe("invalid-content");
    expect(topicRowStatus({ ...good, topic_fingerprint: "0".repeat(64) }, "2026-09-11")).toBe("fingerprint-mismatch");
  });
});

/**
 * PER-MODEL TIMEOUTS — a historically unhealthy pool must not burn the full
 * maximum wait on every attempt, but quality requirements never silently drop
 * (the default stays 60s; overrides are explicit, bounded, and per model).
 */
describe("modelTimeoutMs (per-model failover budget)", () => {
  it("defaults to 60s and honours bounded per-model overrides", () => {
    const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
    expect(modelTimeoutMs("nvidia/nemotron-3-ultra-550b-a55b", env({}))).toBe(60_000);
    expect(
      modelTimeoutMs("nvidia/nemotron-3.5-lightning:free", env({ NVIDIA_NEMOTRON_3_5_LIGHTNING_FREE_TIMEOUT_MS: "25000" })),
    ).toBe(25_000);
    // Out-of-range overrides fall back instead of weakening or stalling.
    expect(modelTimeoutMs("m", env({ M_TIMEOUT_MS: "1000" }))).toBe(60_000);
    expect(modelTimeoutMs("m", env({ M_TIMEOUT_MS: "999999" }))).toBe(60_000);
    expect(modelTimeoutMs("m", env({ M_TIMEOUT_MS: "nope" }))).toBe(60_000);
  });
});

/**
 * PROVIDER DETAIL vs AVAILABILITY — the result separates what the workflow's
 * record step derives downstream (generator_result + provider_health) from
 * the stored-topic outcome: providerError/providerAttempts ride on every
 * path, and success-leg attempts are propagated (not just failures) so
 * longitudinal rates are never computed from failure-only telemetry.
 */
describe("provider detail separation (availability vs provider health)", () => {
  const NOW = new Date("2026-09-11T02:00:00Z");
  const silent = { log: () => {} } as const;

  it("provider failure stores the fallback with bucketed per-model attempts", async () => {
    const db = fakeDb();
    const generate = async () => {
      const err = new Error("timeout of 60000ms exceeded") as Error & { attempts: unknown[] };
      err.attempts = [{ provider: "nvidia", model: "m", outcome: "timeout", latencyMs: 60000, httpStatus: null, errorCategory: "timeout", error: "timeout of 60000ms exceeded" }];
      throw err;
    };
    const result = await runGeneration({ query: db.query, env: { NVIDIA_API_KEY: "x" }, generate, retrieve: async () => [], now: NOW, ...silent });
    expect(result.outcome).toBe("provider-failure");
    expect(result.source).toBe("fallback");
    expect(result.providerError).toMatch(/timeout/i);
    expect(result.providerAttempts).toHaveLength(1);
    expect(db.topics.size).toBe(1);
  });

  it("policy fallback (no keys) carries no provider error or attempts", async () => {
    const db = fakeDb();
    const result = await runGeneration({ query: db.query, env: {}, retrieve: async () => [], now: NOW, ...silent });
    expect(result.outcome).toBe("curated-fallback");
    expect(result.providerError).toBeNull();
    expect(result.providerAttempts).toBeNull();
  });

  it("AI success propagates success-leg attempts for longitudinal stats", async () => {
    const db = fakeDb();
    const attempts = [{ provider: "openrouter", model: "m", outcome: "success", latencyMs: 1200, httpStatus: null, errorCategory: null }];
    const generate = async () => {
      const out = [
        { title: "Cities should eliminate minimum parking requirements", prompt: "Should planning rules stop requiring parking?", category: "Policy", sources: [] },
      ] as unknown as Array<Record<string, unknown>> & { attempts?: unknown[] };
      (out as { attempts?: unknown[] }).attempts = attempts;
      return out;
    };
    const result = await runGeneration({ query: db.query, env: { NVIDIA_API_KEY: "x" }, generate, retrieve: async () => [], now: NOW, ...silent });
    expect(result.outcome).toBe("ai-generated");
    expect(result.providerError).toBeNull();
    expect(result.providerAttempts).toEqual(attempts);
  });
});

/**
 * PROVIDER-LEVEL FAILOVER + ATTEMPT IDENTITY (items 10-11).
 *
 * Generation walks every usable provider's model chain in priority order
 * before the curated fallback, skipping providers without capacity. Every
 * attempt records provider, model, outcome, latency, HTTP status and error
 * category — never reordered from a single failure (ordering stays
 * configured priority; stats inform humans).
 */
describe("provider-level failover", () => {
  const NOW = new Date("2026-09-11T02:00:00Z");
  const silent = { log: () => {} } as const;
  const candidate = {
    title: "Cities should eliminate minimum parking requirements",
    prompt: "Should planning rules stop requiring parking?",
    category: "Policy",
    sources: [],
  };
  const aiBody = () => ({
    choices: [{ message: { content: JSON.stringify({ topics: [candidate] }) } }],
  });
  const realFetch = globalThis.fetch;

  function stubFetch(handler: (url: string) => unknown) {
    globalThis.fetch = (async (url: unknown) => handler(String(url))) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("provider A failure moves to provider B and records both attempts", async () => {
    const db = fakeDb();
    stubFetch((url) => {
      if (url.includes("integrate.api.nvidia.com")) throw new Error("timeout of 60000ms exceeded");
      return { ok: true, json: async () => aiBody() };
    });
    const result = await runGeneration({
      query: db.query,
      env: { NVIDIA_API_KEY: "n", OPENROUTER_API_KEY: "o" },
      retrieve: async () => [],
      now: NOW,
      ...silent,
    });
    expect(result.outcome).toBe("ai-generated");
    expect(result.source).toBe("ai");
    const attempts = result.providerAttempts as Array<Record<string, unknown>>;
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts[0].provider).toBe("nvidia");
    expect(attempts[0].outcome).toBe("timeout");
    const success = attempts.find((a) => a.outcome === "success");
    expect(success?.provider).toBe("openrouter");
    for (const a of attempts) {
      expect(a).toHaveProperty("provider");
      expect(a).toHaveProperty("model");
      expect(a).toHaveProperty("outcome");
      expect(a).toHaveProperty("latencyMs");
      expect(a).toHaveProperty("httpStatus");
      expect(a).toHaveProperty("errorCategory");
    }
  });

  it("HTTP failures capture status and category (429)", async () => {
    const db = fakeDb();
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return { ok: false, status: 429 };
    });
    const result = await runGeneration({
      query: db.query,
      env: { OPENROUTER_API_KEY: "o" },
      retrieve: async () => [],
      now: NOW,
      ...silent,
    });
    expect(result.outcome).toBe("provider-failure");
    expect(calls).toBe(3); // full openrouter chain attempted before fallback
    const attempts = result.providerAttempts as Array<Record<string, unknown>>;
    expect(attempts.every((a) => a.httpStatus === 429)).toBe(true);
    expect(attempts.every((a) => a.outcome === "rate-limit")).toBe(true);
    expect(attempts.every((a) => a.provider === "openrouter")).toBe(true);
  });

  it("all providers failing reaches the curated fallback", async () => {
    const db = fakeDb();
    stubFetch(() => { throw new Error("socket hang up"); });
    const result = await runGeneration({
      query: db.query,
      env: { NVIDIA_API_KEY: "n", OPENROUTER_API_KEY: "o", UNOROUTER_API_KEY: "u" },
      retrieve: async () => [],
      now: NOW,
      ...silent,
    });
    expect(result.outcome).toBe("provider-failure");
    expect(result.source).toBe("fallback");
    const providers = new Set((result.providerAttempts as Array<Record<string, unknown>>).map((a) => a.provider));
    expect(providers.has("nvidia")).toBe(true);
    expect(providers.has("openrouter")).toBe(true);
    expect(providers.has("unorouter")).toBe(true);
    expect(db.topics.size).toBe(1); // availability preserved
  });

  it("kiraai is skipped without an explicit opt-in, used with one", async () => {
    const db = fakeDb();
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(String(url));
      return { ok: true, json: async () => aiBody() };
    });
    const skipped = await runGeneration({
      query: db.query, env: { KIRAAI_API_KEY: "k" }, retrieve: async () => [], now: NOW, ...silent,
    });
    expect(skipped.outcome).toBe("curated-fallback"); // no usable provider: policy fallback
    expect(seen).toHaveLength(0); // never called blind
    const db2 = fakeDb();
    const used = await runGeneration({
      query: db2.query, env: { KIRAAI_API_KEY: "k", KIRAAI_ENABLED: "1" }, retrieve: async () => [], now: NOW, ...silent,
    });
    expect(used.outcome).toBe("ai-generated");
    expect(seen.some((u) => u.includes("kiraai.vn"))).toBe(true);
  });

  it("an explicitly disabled provider is skipped", async () => {
    const db = fakeDb();
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(String(url));
      return { ok: true, json: async () => aiBody() };
    });
    const result = await runGeneration({
      query: db.query,
      env: { OPENROUTER_API_KEY: "o", UNOROUTER_API_KEY: "u", OPENROUTER_DISABLED: "1" },
      retrieve: async () => [],
      now: NOW,
      ...silent,
    });
    expect(result.outcome).toBe("ai-generated");
    expect(seen.some((u) => u.includes("openrouter.ai"))).toBe(false);
    expect(seen.some((u) => u.includes("unorouter.com"))).toBe(true);
  });
});

/**
 * OPERATIONAL TIMEOUT TIERS (item 12): chain-head vs fallback budgets with
 * bounded per-model overrides. Timeouts bound the wait; they never relax
 * schema or content quality.
 */
describe("timeoutForAttempt (operational tiers)", () => {
  const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
  it("prefers explicit tiers, then per-model keys, then the 60s default", () => {
    expect(timeoutForAttempt("m", 0, env({}))).toBe(60_000);
    expect(timeoutForAttempt("m", 2, env({}))).toBe(60_000);
    expect(timeoutForAttempt("m", 0, env({ TOPIC_PRIMARY_TIMEOUT_MS: "30000" }))).toBe(30_000);
    expect(timeoutForAttempt("m", 1, env({ TOPIC_FALLBACK_TIMEOUT_MS: "20000" }))).toBe(20_000);
    // Primary tier does not leak into fallback models and vice versa.
    expect(timeoutForAttempt("m", 1, env({ TOPIC_PRIMARY_TIMEOUT_MS: "30000" }))).toBe(60_000);
    expect(timeoutForAttempt("m", 0, env({ TOPIC_FALLBACK_TIMEOUT_MS: "20000" }))).toBe(60_000);
    // Per-model keys still work beneath the tiers.
    expect(timeoutForAttempt("my-model", 0, env({ MY_MODEL_TIMEOUT_MS: "25000" }))).toBe(25_000);
    // Out-of-range tier values fall back instead of stalling or rushing.
    expect(timeoutForAttempt("m", 0, env({ TOPIC_PRIMARY_TIMEOUT_MS: "1000" }))).toBe(60_000);
    expect(timeoutForAttempt("m", 1, env({ TOPIC_FALLBACK_TIMEOUT_MS: "999999" }))).toBe(60_000);
  });
});

/**
 * PRODUCTION WRITE REGRESSION — jsonb parameter binding.
 *
 * Real scheduled runs failed on the store-topic step with
 * `invalid input syntax for type json`. The Neon HTTP transport serialises a
 * JS array as a Postgres array literal (`{a,b}`), which a jsonb column
 * rejects. The curated fallback only ever stored successfully because its
 * `sources` was empty (`[]` -> `{}`, which happens to parse as JSON) — so
 * every AI-generated topic failed the production write. This double enforces
 * real jsonb semantics so the defect cannot silently return.
 */
describe("jsonb parameter binding (production write regression)", () => {
  // Strict double: a jsonb column accepts a JSON *string*; anything else is
  // the exact production failure (`invalid input syntax for type json`).
  // Mirrors the write-once production path (DO NOTHING + fingerprints).
  function jsonbStrictDb() {
    const topics = new Map<string, Row>();
    const evidence: Row[] = [];
    const jsonbBound: unknown[] = [];
    let seq = 0;

    const asJsonb = (value: unknown, column: string): string => {
      jsonbBound.push(value);
      if (typeof value !== "string") throw new Error(`invalid input syntax for type json (${column})`);
      JSON.parse(value);
      return value;
    };

    const query = async (text: string, params: unknown[] = []): Promise<Row[]> => {
      const sql = text.replace(/\s+/g, " ").trim();
      if (/^(BEGIN|COMMIT|ROLLBACK);?$/.test(sql)) return []; // transactional control statements
      if (/^SELECT column_name FROM information_schema/i.test(sql)) {
        const col = /column_name = '([a-z_]+)'/.exec(sql)?.[1] ?? "topic_fingerprint";
        return [{ column_name: col }];
      }
      if (/^SELECT title FROM daily_topics/i.test(sql)) {
        return [...topics.values()].map((r) => ({ title: r.title }));
      }
      if (/^SELECT .* FROM daily_topics WHERE topic_date/i.test(sql)) {
        const [date] = params as [string];
        const row = topics.get(date);
        return row ? [{ ...row }] : [];
      }
      if (/^INSERT INTO daily_topics/i.test(sql)) {
        const [date, title, prompt, category, sources, source, fingerprint] = params as [
          string, string, string, string, unknown, string, string?,
        ];
        if (topics.has(date)) return []; // ON CONFLICT DO NOTHING
        topics.set(date, {
          id: ++seq,
          topic_date: date,
          title,
          prompt,
          category,
          sources: asJsonb(sources, "daily_topics.sources"),
          generation_source: source,
          topic_fingerprint: fingerprint ?? null,
        });
        return [{ id: seq }];
      }
      if (/^DELETE FROM topic_evidence WHERE topic_id/i.test(sql)) {
        const [topicId] = params as [number];
        for (let i = evidence.length - 1; i >= 0; i--) {
          if (evidence[i].topic_id === topicId) evidence.splice(i, 1);
        }
        return [];
      }
      if (/^INSERT INTO topic_evidence/i.test(sql)) {
        const hasFp = /topic_fingerprint/i.test(sql);
        const [topicId, claim, , , url, , , , checks, fp] = params as unknown[];
        evidence.push({
          topic_id: topicId, claim, url, checks: asJsonb(checks, "topic_evidence.checks"),
          topic_fingerprint: hasFp ? (fp as string) : null,
        });
        return [];
      }
      if (/^SELECT count\(\*\)::int AS total/i.test(sql)) {
        const [topicId] = params as [number];
        const rows = evidence.filter((c) => c.topic_id === topicId);
        return [{ total: rows.length, mismatched: 0, unstamped: 0 }];
      }
      throw new Error(`unexpected SQL: ${text.slice(0, 80)}`);
    };

    return { topics, evidence, jsonbBound, query };
  }

  const NOW = new Date("2026-09-11T02:00:00Z");
  const silent = { log: () => {} } as const;

  it("stores an AI topic with non-empty sources (the exact production failure)", async () => {
    const db = jsonbStrictDb();
    const generate = async () => [
      {
        title: "Cities should eliminate minimum parking requirements",
        prompt: "Should planning rules stop requiring parking?",
        category: "Policy",
        sources: ["https://nrel.gov/a", "https://pewresearch.org/b"],
      },
    ];
    const result = await runGeneration({
      query: db.query, env: { NVIDIA_API_KEY: "x" }, generate, retrieve: async () => [], now: NOW, ...silent,
    });
    expect(result.outcome).toBe("ai-generated");
    expect(db.topics.size).toBe(1);
    // Round-trips as the same array, not a Postgres array literal `{...}`.
    expect(JSON.parse(String([...db.topics.values()][0].sources)))
      .toEqual(["https://nrel.gov/a", "https://pewresearch.org/b"]);
  });

  it("binds every jsonb parameter as a JSON string, never a raw array/object", async () => {
    const db = jsonbStrictDb();
    const retrieve = async () => [
      {
        claim: "c",
        sourceName: "NREL",
        sourceType: "primary",
        url: "https://nrel.gov",
        passage: "p",
        checks: { reachable: true },
      },
    ];
    await runGeneration({ query: db.query, env: {}, retrieve, now: NOW, ...silent });
    expect(db.jsonbBound.length).toBeGreaterThanOrEqual(2);
    for (const bound of db.jsonbBound) expect(typeof bound).toBe("string");
    expect(JSON.parse(String(db.jsonbBound[db.jsonbBound.length - 1]))).toEqual({ reachable: true });
  });

  it("round-trips non-empty nested source objects, empty arrays and empty objects", async () => {
    const db = jsonbStrictDb();
    const nestedSources = [
      { name: "Pew Research Center", homepage: "https://www.pewresearch.org", angle: "polling data" },
      { name: "NREL", homepage: "https://www.nrel.gov", angle: "cost curves", extra: { since: 2010, units: ["USD/W"] } },
    ];
    const generate = async () => [
      {
        title: "Cities should eliminate minimum parking requirements",
        prompt: "Should planning rules stop requiring parking?",
        category: "Policy",
        sources: nestedSources,
      },
    ];
    const retrieve = async () => [
      {
        claim: "c", sourceName: "NREL", sourceType: "primary", url: "https://nrel.gov",
        passage: "p", checks: { nested: { a: [1, 2] } },
      },
    ];
    const result = await runGeneration({
      query: db.query, env: { NVIDIA_API_KEY: "x" }, generate, retrieve, now: NOW, ...silent,
    });
    expect(result.outcome).toBe("ai-generated");
    expect(JSON.parse(String([...db.topics.values()][0].sources))).toEqual(nestedSources);
    expect(JSON.parse(String(db.evidence[0].checks))).toEqual({ nested: { a: [1, 2] } });

    // Empty arrays and empty objects serialise as valid JSON, never raw bindings.
    const db2 = jsonbStrictDb();
    const empty = await runGeneration({ query: db2.query, env: {}, retrieve: async () => [], now: NOW, ...silent });
    expect(empty.outcome).toBe("curated-fallback");
    expect(JSON.parse(String([...db2.topics.values()][0].sources))).toEqual([]);
  });
});

describe("resolveTargetDate (cycle-boundary rule)", () => {
  it("on-time evening slots target tomorrow", () => {
    for (const at of ["2026-09-16T20:00:00Z", "2026-09-16T21:30:00Z", "2026-09-16T22:45:00Z", "2026-09-16T23:40:00Z"]) {
      expect(resolveTargetDate(new Date(at))).toBe("2026-09-17");
    }
  });

  it("executions that slip past midnight still target the previous cycle's tomorrow (today)", () => {
    // GitHub scheduled starts observed 4-5h late: a 23:40 slot starting at
    // 04:00 must still recover 2026-09-17, not abandon it for 09-18.
    for (const at of ["2026-09-17T00:10:00Z", "2026-09-17T02:00:00Z", "2026-09-17T04:00:00Z", "2026-09-17T14:59:00Z"]) {
      expect(resolveTargetDate(new Date(at))).toBe("2026-09-17");
    }
  });

  it("flips to the next cycle exactly at the 15:00 UTC boundary", () => {
    expect(resolveTargetDate(new Date("2026-09-17T15:00:00Z"))).toBe("2026-09-18");
  });

  it("midday manual dispatches (15:00-23:59) target tomorrow", () => {
    expect(resolveTargetDate(new Date("2026-09-16T15:00:00Z"))).toBe("2026-09-17");
    expect(resolveTargetDate(new Date("2026-09-16T18:00:00Z"))).toBe("2026-09-17");
  });
});
