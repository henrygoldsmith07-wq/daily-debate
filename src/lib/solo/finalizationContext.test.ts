import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { emptyGraph } from "@/lib/argGraph";
import { loadSoloFinalizationContext } from "./finalizationContext";

function graph() {
  return emptyGraph();
}

function fakeDb(priorDebates: Array<{ id: string; completed_at: string | null }>) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain = (table: string, result: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "order", "limit", "not", "single", "maybeSingle"]) {
      q[m] = (...args: unknown[]) => {
        calls.push([`${table}.${m}`, ...args]);
        return q;
      };
    }
    q.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return q;
  };
  const db = {
    from(table: string) {
      if (table === "daily_topics") return chain(table, { data: { title: "T", category: null }, error: null });
      if (table === "solo_debates") {
        // Emulate the DB honouring the NOT NULL filter only if the query asks for it.
        const q = chain(table, null) as Record<string, unknown>;
        const original = q.not as (...a: unknown[]) => unknown;
        let filtered = false;
        q.not = (...a: unknown[]) => {
          if (a[0] === "completed_at" && a[1] === "is" && a[2] === null) filtered = true;
          return original(...a);
        };
        q.then = (resolve: (v: unknown) => unknown) =>
          resolve({ data: filtered ? priorDebates.filter((d) => d.completed_at) : priorDebates, error: null });
        return q;
      }
      return chain(table, {
        data: priorDebates.map((d) => ({ debate_id: d.id, assessment: { graph: graph() } })),
        error: null,
      });
    },
  };
  return { db, calls };
}

describe("loadSoloFinalizationContext", () => {
  it("never stamps a prior debate with no completion time as now", async () => {
    const { db } = fakeDb([
      { id: "d1", completed_at: null },
      { id: "d2", completed_at: "2026-06-02T10:00:00.000Z" },
    ]);
    const res = await loadSoloFinalizationContext({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      userId: "u",
      debateId: "cur",
      topicId: "t",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.priorDebateKinds.map((k) => k.completedAt)).toEqual(["2026-06-02T10:00:00.000Z"]);
  });
});
