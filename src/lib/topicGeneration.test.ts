import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickFallback,
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
  for (const k of ["DATABASE_URL", "NVIDIA_API_KEY", "OPENROUTER_API_KEY", "UNOROUTER_API_KEY", "KIRAAI_API_KEY", "BAI_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_FALLBACK_MODELS", "ANTHROPIC_API_KEY"]) {
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
});
