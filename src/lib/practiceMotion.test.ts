import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyTopic } from "./types";

type Row = Record<string, unknown>;
const tables: { topics: Row[]; debates: Row[] } = { topics: [], debates: [] };

function query(rows: () => Row[]) {
  const q: Record<string, unknown> = {};
  const filters: Array<[string, unknown]> = [];
  const chain = () => q;
  for (const m of ["select", "order", "limit"]) q[m] = chain;
  q.eq = (col: string, val: unknown) => {
    filters.push([col, val]);
    return q;
  };
  const run = () => rows().filter((r) => filters.every(([c, v]) => r[c] === undefined || r[c] === v));
  q.maybeSingle = async () => ({ data: run()[0] ?? null });
  q.then = (resolve: (v: { data: Row[] }) => unknown) => resolve({ data: run() });
  return q;
}

vi.mock("./backend/server", () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      query(() => (table === "daily_topics" ? tables.topics : tables.debates)),
  }),
}));

import { resolvePracticeMotion } from "./practiceMotion";

const topic = (id: string, category = "ethics"): DailyTopic =>
  ({ id, title: `T-${id}`, prompt: `P-${id}`, category }) as unknown as DailyTopic;

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => {
  tables.topics = [topic("a"), topic("b", "tech"), topic("c", "politics")] as unknown as Row[];
  tables.debates = [];
});

describe("resolvePracticeMotion with a due retest", () => {
  it("serves the shared motion when it is a different topic, even on the repair day", async () => {
    const r = await resolvePracticeMotion({
      userId: "u",
      shared: topic("b", "tech"),
      dueRetest: { topicId: "a", attemptedAt: new Date(), dimension: "evidence" },
    });
    expect(r.topic.id).toBe("b");
    expect(r.servesRetest).toBe(true);
    expect(r.isShared).toBe(true);
  });

  it("keeps the shared motion and leaves the retest queued on a same-day replay of the repaired topic", async () => {
    const r = await resolvePracticeMotion({
      userId: "u",
      shared: topic("a"),
      dueRetest: { topicId: "a", attemptedAt: `${today}T08:00:00Z`, dimension: "logic" },
    });
    expect(r.topic.id).toBe("a");
    expect(r.servesRetest).toBe(false);
    expect(r.isShared).toBe(true);
  });

  it("swaps to a different motion on a later day when the shared motion is the repaired topic", async () => {
    const r = await resolvePracticeMotion({
      userId: "u",
      shared: topic("a"),
      dueRetest: { topicId: "a", attemptedAt: yesterday, dimension: "logic" },
    });
    expect(r.servesRetest).toBe(true);
    expect(r.isShared).toBe(false);
    expect(r.topic.id).not.toBe("a");
    expect(r.reasonLine).toBeTruthy();
  });

  it("accepts a Date attemptedAt from the Postgres layer", async () => {
    const r = await resolvePracticeMotion({
      userId: "u",
      shared: topic("a"),
      dueRetest: { topicId: "a", attemptedAt: new Date(Date.now() - 86_400_000), dimension: "logic" },
    });
    expect(r.servesRetest).toBe(true);
    expect(r.topic.id).not.toBe("a");
  });

  it("never claims to serve a retest when the repaired topic is unknown", async () => {
    const r = await resolvePracticeMotion({
      userId: "u",
      shared: topic("a"),
      dueRetest: { topicId: null, attemptedAt: yesterday, dimension: "logic" },
    });
    expect(r.servesRetest).toBe(false);
    expect(r.topic.id).toBe("a");
  });
});

describe("resolvePracticeMotion with no retest due", () => {
  it("returns the shared motion for a user with no history", async () => {
    const r = await resolvePracticeMotion({ userId: "u", shared: topic("a"), dueRetest: null });
    expect(r.topic.id).toBe("a");
    expect(r.isShared).toBe(true);
    expect(r.servesRetest).toBe(false);
    expect(r.reasonLine).toBeNull();
  });
});
