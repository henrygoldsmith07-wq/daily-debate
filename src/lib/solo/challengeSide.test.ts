import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendClient } from "@/lib/backend/client";

// The home screen reveals the "Challenge me" side before the debate starts.
// These tests pin the promise that reveal makes: the side previewed by
// `loadChallengeAssignment` is the side `startSoloDebate` opens the debate on.

vi.mock("@/lib/coachingContextServer", () => ({
  loadCoachingContext: vi.fn(async () => ({
    ledger: null,
    drillOutcomes: [],
    pendingRetests: [],
    selectedRetest: null,
    repairAnchors: [],
    degradationReasons: [],
    status: "ok",
  })),
}));
vi.mock("@/lib/openrouter", () => ({
  debateOpening: vi.fn(async () => "Opening argument."),
}));

import { loadChallengeAssignment } from "./challengeSide";
import { startSoloDebate } from "./startDebate";

type HistoryRow = { id: string; side: "for" | "against"; total_score: number | null; performance_score: number | null };

interface FakeOptions {
  history?: HistoryRow[];
  historyError?: boolean;
  legacyTurns?: Array<{ debate_id: string; id: string }>;
}

/** Minimal chainable query fake: every builder method returns the builder; awaiting it resolves the table's canned answer. */
function fakeDb(options: FakeOptions) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    const answer = () => {
      if (table === "daily_topics") {
        return { data: { id: "topic-1", title: "Motion", prompt: "Prompt" }, error: null };
      }
      if (table === "solo_debates") {
        if (filters.status === "active") return { data: null, error: null };
        if (options.historyError) return { data: null, error: { message: "boom" } };
        return { data: options.history ?? [], error: null };
      }
      if (table === "solo_debate_turns") return { data: options.legacyTurns ?? [], error: null };
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit", "in", "not"]) b[method] = () => b;
    b.eq = (column: string, value: unknown) => {
      filters[column] = value;
      return b;
    };
    b.single = async () => answer();
    b.maybeSingle = async () => answer();
    b.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(answer()).then(resolve, reject);
    return b;
  }
  const db = {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "claim_solo_debate_start") return { data: { claimed: true }, error: null };
      if (fn === "complete_solo_debate_start") {
        const coaching = JSON.parse(String(args.p_coaching));
        return {
          data: {
            ok: true,
            debate: { id: "debate-1", side: args.p_side, format: args.p_format, coaching, persona: null, difficulty: null },
            turn: { id: "turn-1", round_number: 1 },
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };
  return { db: db as unknown as BackendClient, rpcCalls };
}

async function startWithChallenge(db: BackendClient, userId: string, topicId: string) {
  return startSoloDebate({
    db,
    userId,
    topicId,
    sideChoice: "challenge",
    format: "sprint",
    persona: "balanced",
    difficulty: "challenging",
  });
}

describe("Challenge me: pre-start reveal matches the started debate", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("cold start: the previewed random side is the side the debate opens on, every time", async () => {
    const sides = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const userId = `user-${i}`;
      const { db } = fakeDb({ history: [] });
      const preview = await loadChallengeAssignment({ db, userId, topicId: "topic-1" });
      expect(preview.rule).toBe("random-cold-start");
      const started = await startWithChallenge(db, userId, "topic-1");
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      expect(started.data.side).toBe(preview.side);
      expect(started.data.sideReason).toBe(preview.reason);
      sides.add(preview.side);
    }
    // Seeded, not constant: across users the flip still lands on both sides.
    expect(sides).toEqual(new Set(["for", "against"]));
  });

  it("cold start preview is stable across reloads for the same user and motion", async () => {
    const { db } = fakeDb({ history: [] });
    const first = await loadChallengeAssignment({ db, userId: "u", topicId: "t" });
    for (let i = 0; i < 10; i++) {
      expect(await loadChallengeAssignment({ db, userId: "u", topicId: "t" })).toEqual(first);
    }
  });

  it("history unavailable: still a stable seeded side, honestly labelled", async () => {
    const { db } = fakeDb({ historyError: true });
    const preview = await loadChallengeAssignment({ db, userId: "u", topicId: "t" });
    expect(preview.rule).toBe("random-history-unavailable");
    const started = await startWithChallenge(db, "u", "t");
    expect(started.ok && started.data.side).toBe(preview.side);
  });

  it("side balance: a FOR-heavy history previews AGAINST and starts AGAINST, recording the rule", async () => {
    const history: HistoryRow[] = [0, 1, 2, 3].map((i) => ({ id: `d${i}`, side: "for", total_score: null, performance_score: 60 }));
    const { db, rpcCalls } = fakeDb({ history });
    const preview = await loadChallengeAssignment({ db, userId: "u", topicId: "t" });
    expect(preview).toMatchObject({ side: "against", rule: "side-balance" });
    const started = await startWithChallenge(db, "u", "t");
    expect(started.ok && started.data.side).toBe("against");
    const complete = rpcCalls.find((c) => c.fn === "complete_solo_debate_start");
    expect(complete?.args.p_side).toBe("against");
    expect(complete?.args.p_side_rule).toBe("side-balance");
  });

  it("legacy rows without performance_score are normalised from answered turns (performance gap)", async () => {
    // Rows arrive newest-first. FOR debates scored 40/2 turns => 40; AGAINST 20/2 => 20.
    const history: HistoryRow[] = [
      { id: "a2", side: "against", total_score: 20, performance_score: null },
      { id: "f2", side: "for", total_score: 40, performance_score: null },
      { id: "a1", side: "against", total_score: 20, performance_score: null },
      { id: "f1", side: "for", total_score: 40, performance_score: null },
    ];
    const legacyTurns = history.flatMap((row) => [
      { debate_id: row.id, id: `${row.id}-t1` },
      { debate_id: row.id, id: `${row.id}-t2` },
    ]);
    const { db } = fakeDb({ history, legacyTurns });
    const preview = await loadChallengeAssignment({ db, userId: "u", topicId: "t" });
    expect(preview).toMatchObject({ side: "against", rule: "performance-gap" });
  });
});
