import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  modelTimeoutMs,
  pickFallback,
  resolveTargetDate,
  runGeneration,
  scoreCandidate,
  scoreNovelty,
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
 * PIPELINE INTEGRATION — runGeneration against an in-memory query double.
 * Proves the write path end to end (topic + evidence + provenance) and,
 * crucially, that an immediate re-run for the SAME target date is safe:
 * one topic row, no duplicate or lost evidence, consistent provenance.
 */
describe("runGeneration pipeline (injected query)", () => {
  type Row = Record<string, unknown>;
  interface Fake {
    topics: Map<string, Row & { id: number }>;
    evidence: Row[];
    queries: string[];
    query: (text: string, params?: unknown[]) => Promise<Row[]>;
  }
  function fakeDb(): Fake {
    const topics = new Map<string, Row & { id: number }>();
    const evidence: Row[] = [];
    const queries: string[] = [];
    let seq = 0;
    const query = async (text: string, params: unknown[] = []): Promise<Row[]> => {
      queries.push(text.replace(/\s+/g, " ").trim().slice(0, 40));
      if (/^SELECT title FROM daily_topics/i.test(text)) {
        return [...topics.values()].map((r) => ({ title: r.title }));
      }
      if (/^INSERT INTO daily_topics/i.test(text)) {
        const [date, title, prompt, category, sources, source] = params as [string, string, string, string, unknown, string];
        const existing = topics.get(date);
        if (existing) {
          Object.assign(existing, { title, prompt, category, sources, generation_source: source });
          return [{ id: existing.id }];
        }
        const row = { id: ++seq, topic_date: date, title, prompt, category, sources, generation_source: source } as Row & { id: number };
        topics.set(date, row);
        return [{ id: row.id }];
      }
      if (/^DELETE FROM topic_evidence/i.test(text)) {
        const [topicId] = params as [number];
        for (let i = evidence.length - 1; i >= 0; i--) if (evidence[i].topic_id === topicId) evidence.splice(i, 1);
        return [];
      }
      if (/^INSERT INTO topic_evidence/i.test(text)) {
        const [topicId, claim, sourceName] = params as [number, string, string];
        evidence.push({ topic_id: topicId, claim, source_name: sourceName });
        return [];
      }
      throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
    };
    return { topics, evidence, queries, query };
  }

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
    expect(db.topics.size).toBe(1);
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
  type Row = Record<string, unknown>;
  function fakeDb() {
    const topics = new Map<string, Row & { id: number }>();
    let seq = 0;
    const query = async (text: string, params: unknown[] = []): Promise<Row[]> => {
      if (/^SELECT title FROM daily_topics/i.test(text)) {
        return [...topics.values()].map((r) => ({ title: r.title }));
      }
      if (/^INSERT INTO daily_topics/i.test(text)) {
        const [date, title, prompt, category, sources, source] = params as [string, string, string, string, unknown, string];
        const existing = topics.get(date);
        if (existing) {
          Object.assign(existing, { title, prompt, category, sources, generation_source: source });
          return [{ id: existing.id }];
        }
        const row = { id: ++seq, topic_date: date, title, prompt, category, sources, generation_source: source } as Row & { id: number };
        topics.set(date, row);
        return [{ id: row.id }];
      }
      if (/^DELETE FROM topic_evidence/i.test(text)) return [];
      if (/^INSERT INTO topic_evidence/i.test(text)) return [];
      throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
    };
    return { topics, query };
  }
  const NOW = new Date("2026-09-11T02:00:00Z");
  const silent = { log: () => {} } as const;

  it("provider failure stores the fallback with bucketed per-model attempts", async () => {
    const db = fakeDb();
    const generate = async () => {
      const err = new Error("timeout of 60000ms exceeded") as Error & { attempts: unknown[] };
      err.attempts = [{ model: "m", outcome: "timeout", latencyMs: 60000, error: "timeout of 60000ms exceeded" }];
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
    const attempts = [{ model: "m", outcome: "success", latencyMs: 1200 }];
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
  type Row = Record<string, unknown>;

  function jsonbStrictDb() {
    const topics = new Map<string, Row>();
    const evidence: Row[] = [];
    const jsonbBound: unknown[] = [];
    let seq = 0;

    // A jsonb column accepts a JSON *string*; anything else is a hard error.
    const asJsonb = (value: unknown, column: string): string => {
      jsonbBound.push(value);
      if (typeof value !== "string") throw new Error(`invalid input syntax for type json (${column})`);
      JSON.parse(value);
      return value;
    };

    const query = async (text: string, params: unknown[] = []): Promise<Row[]> => {
      if (/^SELECT title FROM daily_topics/i.test(text)) {
        return [...topics.values()].map((r) => ({ title: r.title }));
      }
      if (/^INSERT INTO daily_topics/i.test(text)) {
        const [date, title, prompt, category, sources, source] = params as [
          string, string, string, string, unknown, string,
        ];
        topics.set(date, {
          topic_date: date,
          title,
          prompt,
          category,
          sources: asJsonb(sources, "daily_topics.sources"),
          generation_source: source,
        });
        return [{ id: ++seq }];
      }
      if (/^DELETE FROM topic_evidence/i.test(text)) {
        const [topicId] = params as [number];
        for (let i = evidence.length - 1; i >= 0; i--) {
          if (evidence[i].topic_id === topicId) evidence.splice(i, 1);
        }
        return [];
      }
      if (/^INSERT INTO topic_evidence/i.test(text)) {
        const [topicId, claim, , , url, , , , checks] = params as unknown[];
        evidence.push({ topic_id: topicId, claim, url, checks: asJsonb(checks, "topic_evidence.checks") });
        return [];
      }
      throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
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
