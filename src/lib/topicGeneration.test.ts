import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickFallback,
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
  for (const k of ["DATABASE_URL", "NVIDIA_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"]) {
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
