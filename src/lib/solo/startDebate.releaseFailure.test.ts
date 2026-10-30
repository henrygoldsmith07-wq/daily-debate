import { describe, expect, it, vi } from "vitest";
import type { BackendClient } from "../backend/client";
import { DEFAULT_DIFFICULTY, DEFAULT_PERSONA } from "../opponentPersona";

// When the opening model fails, the start claim is released and the learner
// gets a retryable 502. If the release itself throws (store blip), the answer
// must stay that 502 instead of escaping as an unhandled error.

vi.mock("@/lib/coachingContextServer", () => ({
  loadCoachingContext: async () => ({
    status: "ok",
    degradationReasons: [],
    ledger: { points: [], debates: 0, improvements: [] },
    repairAnchors: [],
    pendingRetests: [],
    lapsedRetests: [],
    selectedRetest: null,
    drillOutcomes: {},
    reRepairDimensions: [],
    repairedDimensions: [],
  }),
}));
vi.mock("@/lib/openrouter", () => ({
  debateOpening: async () => {
    throw new Error("provider down");
  },
}));
vi.mock("@/lib/solo/challengeSide", () => ({
  loadChallengeAssignment: async () => ({ side: "for", reason: "r", rule: "random-cold-start" }),
}));

const { startSoloDebate } = await import("./startDebate");

function fakeDb(releaseMode: "throw" | "error", calls: string[]): BackendClient {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["select", "eq", "order", "limit"]) builder[m] = chain;
  const resolve = async () => ({ data: { id: "topic-1", title: "T", prompt: "P" }, error: null });
  builder.single = resolve;
  builder.maybeSingle = async (): Promise<{ data: unknown; error: null }> => ({ data: null, error: null });
  return {
    from: (table: string) => {
      if (table === "daily_topics") return builder;
      return { ...builder, maybeSingle: async () => ({ data: null, error: null }) };
    },
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "claim_solo_debate_start") return { data: { claimed: true }, error: null };
      if (name === "release_solo_debate_start") {
        if (releaseMode === "throw") throw new Error("store unreachable");
        return { data: null, error: { message: "boom" } };
      }
      return { data: null, error: null };
    },
  } as unknown as BackendClient;
}

async function run(releaseMode: "throw" | "error") {
  const calls: string[] = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  const result = await startSoloDebate({
    db: fakeDb(releaseMode, calls),
    userId: "u1",
    topicId: "topic-1",
    sideChoice: "for",
    format: "sprint",
    persona: DEFAULT_PERSONA,
    difficulty: DEFAULT_DIFFICULTY,
  });
  return { result, calls };
}

describe("startSoloDebate claim release failures", () => {
  it("still answers the retryable 502 when releasing the claim throws", async () => {
    const { result, calls } = await run("throw");
    expect(calls).toContain("release_solo_debate_start");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(502);
  });

  it("still answers the retryable 502 when releasing the claim returns an error", async () => {
    const { result } = await run("error");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(502);
  });
});
