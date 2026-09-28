import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
    existing: null as Record<string, unknown> | null,
  };
  const insert = vi.fn(async (value: Record<string, unknown>) => ({
    data: { id: "assignment-1", status: "open", ...value, before_score: value.before_score ?? null },
    error: null,
  }));
  const update = vi.fn(async (value: Record<string, unknown>) => ({
    data: { ...(state.existing ?? {}), ...value },
    error: null,
  }));

  function from(table: string) {
    if (table === "profiles") {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        async single() { return { data: { timezone: "Europe/London" }, error: null }; },
      };
      return builder;
    }

    if (table === "drill_assignments") {
      const filters = new Map<string, unknown>();
      let pendingInsert: Record<string, unknown> | null = null;
      let pendingUpdate: Record<string, unknown> | null = null;
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) { filters.set(column, value); return builder; },
        insert(value: Record<string, unknown>) { pendingInsert = value; return builder; },
        update(value: Record<string, unknown>) { pendingUpdate = value; return builder; },
        async maybeSingle() {
          return { data: state.existing, error: null };
        },
        async single() {
          if (pendingInsert) return insert(pendingInsert);
          if (pendingUpdate) return update(pendingUpdate);
          return { data: state.existing, error: null };
        },
      };
      return builder;
    }

    throw new Error(`Unexpected table: ${table}`);
  }

  return { state, insert, update, from };
});

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/currentViewer", () => ({
  getCurrentUser: vi.fn(async () => h.state.user),
}));
vi.mock("@/lib/dailyTopic", () => ({
  getTodayTopic: vi.fn(async () => ({ id: "topic-1" })),
}));
vi.mock("@/lib/timeZone", () => ({
  dateKeyInTimeZone: vi.fn(() => "2026-09-28"),
}));
vi.mock("@/lib/coachingContextServer", () => ({
  loadCoachingContext: vi.fn(async () => ({
    ledger: { points: [], debates: 4 },
    drillOutcomes: {},
    selectedRetest: null,
    status: "ok",
    degradationReasons: [],
  })),
}));
vi.mock("@/lib/adaptiveCoach", () => ({
  DIMENSION_LABELS: { evidence: "Evidence" },
  buildCoachProfile: vi.fn(() => ({
    dims: [{ key: "evidence", label: "Evidence", score: 42, hasData: true }],
    slopes: { evidence: -0.01 },
  })),
  selectFocus: vi.fn((dims: unknown[]) => ({
    focus: dims[0],
    reason: "lowest profile dimension (42/100)",
  })),
  todaysDrill: vi.fn(() => ({
    minutes: 2,
    title: "Ground one claim",
    prompt: "Support one claim with evidence.",
  })),
}));
vi.mock("@/lib/backend/server", () => ({
  createServiceClient: vi.fn(() => ({ from: h.from })),
}));

import { GET, POST } from "./route";

beforeEach(() => {
  h.state.user = { id: "11111111-1111-4111-8111-111111111111" };
  h.state.existing = null;
  h.insert.mockClear();
  h.update.mockClear();
});

describe("/api/coach/today", () => {
  it("keeps GET side-effect free and returns a drill proposal", async () => {
    const response = await GET(new Request("https://daily-debate.test/api/coach/today"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      assignment: null,
      activationRequired: true,
      proposal: {
        dimension: "evidence",
        title: "Ground one claim",
      },
    });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it("persists the proposed drill only after explicit POST activation", async () => {
    const response = await POST(new Request("https://daily-debate.test/api/coach/today", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: h.state.user!.id,
      dimension: "evidence",
      assigned_date: "2026-09-28",
    }));
    expect(await response.json()).toMatchObject({
      activationRequired: false,
      assignment: {
        id: "assignment-1",
        dimension: "evidence",
        status: "open",
      },
    });
  });
});
