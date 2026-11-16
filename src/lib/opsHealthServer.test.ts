import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchArtifactWitnesses, fetchWorkflowRuns } from "./opsHealthServer";

describe("ops health cold path", () => {
  it("starts every workflow fetch before resolving any of them", async () => {
    const original = globalThis.fetch;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      await gate;
      return new Response(JSON.stringify({
        workflow_runs: [{ name: "workflow", status: "completed", conclusion: "success" }],
      }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const pending = fetchWorkflowRuns("token");
      await new Promise((resolve) => setImmediate(resolve));
      expect(calls).toBe(3); // all three in flight, none resolved yet
      release();
      expect(await pending).toHaveLength(3);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("starts artifact reads for the first four runs in parallel", async () => {
    const original = globalThis.fetch;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      await gate;
      return new Response(JSON.stringify({ artifacts: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const runs = Array.from({ length: 6 }, (_, i) => ({ id: i + 1 })) as Parameters<typeof fetchArtifactWitnesses>[1];
      const pending = fetchArtifactWitnesses("token", runs);
      await new Promise((resolve) => setImmediate(resolve));
      expect(calls).toBe(4); // bounded to four, all in flight
      release();
      expect((await pending).size).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("uses one introspection query for required tables, not eight probes", () => {
    const src = readFileSync(path.resolve(__dirname, "opsHealthServer.ts"), "utf8");
    expect(src).toContain("FROM information_schema.tables");
    expect(src).not.toContain("for (const table of REQUIRED_TABLES)");
  });
});
