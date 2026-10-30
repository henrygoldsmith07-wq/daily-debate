import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendClient } from "../backend/client";
import type { CoachingContext } from "../coachingContextServer";
import { DEFAULT_DIFFICULTY, DEFAULT_PERSONA } from "../opponentPersona";

// Guest → account carry-over at the START route: the first signed-in debate
// of an account with no evidence of its own is started with the focus seeded
// from the guest repair (or the learner's change to it). Before this change
// the debate was started with `dimension: null`, so the carried-over weakness
// was never coached even though the home card promised it.

const context: { value: CoachingContext } = {
  value: {
    status: "ok",
    degradationReasons: [],
    ledger: { points: [], debates: 0, improvements: [] } as unknown as CoachingContext["ledger"],
    repairAnchors: [],
    pendingRetests: [],
    lapsedRetests: [],
    selectedRetest: null,
    drillOutcomes: {},
    reRepairDimensions: [],
    repairedDimensions: [],
  },
};

vi.mock("@/lib/coachingContextServer", () => ({
  loadCoachingContext: async () => context.value,
}));
vi.mock("@/lib/openrouter", () => ({ debateOpening: async () => "Opening line." }));
vi.mock("@/lib/solo/challengeSide", () => ({
  loadChallengeAssignment: async () => ({ side: "for", reason: "r", rule: "random-cold-start" }),
}));

const { startSoloDebate } = await import("./startDebate");

const GUEST = {
  motion: "Schools should ban phones",
  weaknessKind: "evidence",
  weaknessLabel: "Evidence",
  repairState: "repair_demonstrated",
  repairSucceeded: true,
  retestOutcome: "observed",
  completedAt: "2026-10-20T10:00:00.000Z",
};

interface FakeState {
  guestContext: unknown;
  completedDebate: { id: string } | null;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

function fakeDb(state: FakeState): BackendClient {
  function query(table: string) {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    };
    builder.order = chain;
    builder.limit = chain;
    const resolve = () => {
      if (table === "daily_topics") return { data: { id: "topic-1", title: "T", prompt: "P" }, error: null };
      if (table === "profiles") return { data: { guest_context: state.guestContext }, error: null };
      if (table === "solo_debates" && filters.status === "completed") return { data: state.completedDebate, error: null };
      return { data: null, error: null };
    };
    builder.single = async () => resolve();
    builder.maybeSingle = async () => resolve();
    return builder;
  }
  return {
    from: (table: string) => query(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === "claim_solo_debate_start") return { data: { claimed: true }, error: null };
      if (name === "complete_solo_debate_start") {
        return {
          data: {
            ok: true,
            debate: { id: "d1", side: "for", format: "sprint", coaching: JSON.parse(args.p_coaching as string) },
            turn: { id: "t1" },
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  } as unknown as BackendClient;
}

async function start(state: FakeState, firstFocus?: unknown) {
  const result = await startSoloDebate({
    db: fakeDb(state),
    userId: "u1",
    topicId: "topic-1",
    sideChoice: "for",
    format: "sprint",
    persona: DEFAULT_PERSONA,
    difficulty: DEFAULT_DIFFICULTY,
    firstFocus,
  });
  expect(result.ok).toBe(true);
  const call = state.rpcCalls.find((c) => c.name === "complete_solo_debate_start");
  return JSON.parse(call!.args.p_coaching as string) as Record<string, unknown>;
}

function freshState(overrides: Partial<FakeState> = {}): FakeState {
  return { guestContext: GUEST, completedDebate: null, rpcCalls: [], ...overrides };
}

beforeEach(() => {
  context.value = {
    ...context.value,
    ledger: { points: [], debates: 0, improvements: [] } as unknown as CoachingContext["ledger"],
    pendingRetests: [],
  };
});

describe("first signed-in debate after guest practice", () => {
  it("starts with the guest repair's skill as the coached focus, marked as guest-sourced", async () => {
    const coaching = await start(freshState());
    expect(coaching.dimension).toBe("evidence");
    expect(coaching.focusSource).toBe("guest-practice");
    // Never a retest: the guest rep is not a repair anchor.
    expect(coaching.repairRetest).toBeNull();
  });

  it("honours the learner's change to another focus", async () => {
    const coaching = await start(freshState(), "rebuttal");
    expect(coaching.dimension).toBe("rebuttal");
    expect(coaching.focusSource).toBe("learner-choice");
  });

  it("honours turning the focus off", async () => {
    const coaching = await start(freshState(), "none");
    expect(coaching.dimension).toBeNull();
    expect(coaching).not.toHaveProperty("focusSource");
  });

  it("ignores an invalid requested focus and keeps the guest seed", async () => {
    const coaching = await start(freshState(), "telepathy");
    expect(coaching.dimension).toBe("evidence");
  });

  it("does not seed once the account has a completed debate of its own", async () => {
    const coaching = await start(freshState({ completedDebate: { id: "old" } }), "rebuttal");
    expect(coaching.dimension).toBeNull();
    expect(coaching).not.toHaveProperty("focusSource");
  });

  it("does not seed (or honour a requested focus) without a guest summary", async () => {
    const coaching = await start(freshState({ guestContext: null }), "rebuttal");
    expect(coaching.dimension).toBeNull();
  });

  it("never seeds a skill that is under silent test", async () => {
    context.value = {
      ...context.value,
      pendingRetests: [
        {
          repairResultId: "r1",
          debateId: "d0",
          targetKind: "evidence",
          attemptedAt: "2026-10-20T10:00:00.000Z",
          topicId: "topic-0",
          dimension: "evidence",
        },
      ],
    };
    const coaching = await start(freshState(), "evidence");
    expect(coaching.dimension).toBeNull();
  });
});
