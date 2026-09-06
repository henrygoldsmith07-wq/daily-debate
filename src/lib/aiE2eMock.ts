import "server-only";

import type { DebateSummary } from "./types";
import type { DebateTurnResult } from "./openrouter";
import type { ArgGraph } from "./argGraph";

/**
 * Deterministic offline AI for authenticated E2E runs.
 *
 * The E2E specs cannot intercept the server-side provider calls (Playwright
 * routes only see browser traffic), and CI must not spend tokens or hold API
 * keys. Setting E2E_MOCK_AI=1 on the *server* switches the primary provider's
 * entry points to the scripted responses below. This flag is never set in real
 * deployments; withProviderFallback's anthropic leg is therefore unreachable
 * while the mock is active (the primary always validates).
 *
 * Shapes mirror what the provider schema validation accepts so the routes'
 * own validation still exercises.
 */

export function e2eMockAiEnabled(): boolean {
  return process.env.E2E_MOCK_AI === "1";
}

export function mockDebateOpening(): string {
  return "To open: your position rests on efficiency, but efficiency claims must survive a distributional challenge. Consider who bears the adjustment costs before claiming a net benefit. According to NREL data, costs have fallen; yet grid reliability requires storage investment, which shifts the total calculation across regions and time horizons.";
}

export function mockDebateTurn(): DebateTurnResult {
  return {
    aiMessage:
      "However, consider the counterfactual: without accounting for adjustment costs, the claimed outcome may not hold across regions and time horizons. Your response asserts the benefit but does not engage the distributional evidence on the other side.",
    feedback: "Good structural argument — clear claim, but add a cited source to strengthen the evidence.",
  };
}

export function mockDebateSummary(): DebateSummary {
  return {
    overallFeedback:
      "You held a consistent line and answered the counter-position directly. The closing rounds were your strongest.",
    strengths: ["Consistent claim structure", "Direct engagement with the counter-position"],
    improvements: ["Cite at least one institutional source per round", "Quantify the impact comparison"],
    argGraph: {
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "E2E claim under test.", round: 1 },
        { id: "e1", kind: "evidence", owner: "a", text: "Supporting evidence.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
        { id: "o1", kind: "counterclaim", owner: "ai", text: "Counter-position raised by the opponent.", round: 1 },
      ],
      edges: [{ from: "e1", to: "c1", relation: "supports" }],
      dropped: [],
      contradictions: [],
      concessions: [],
      fallacies: [],
      evidenceStats: {
        total: 1,
        byOwner: { a: 1, b: 0, ai: 0 },
        byStrength: { anecdotal: 0, general: 0, cited: 1, strong: 0 },
        unsupportedClaimIds: [],
      },
      impactComparison: null,
    },
  };
}

// The PvP verdict path derives winner and scores from the argGraph itself
// (finalizePvpAssessment ignores any model-supplied numbers), so the mock must
// return the same extractor shape as a real judge call: rationale + graph.
// Side "a" carries two supported claims with cited evidence; side "b" carries
// one unsupported claim, so the deterministic assessment favours "a".
export function mockPvpJudge(): { rationale: string; argGraph: ArgGraph } {
  return {
    rationale: "Player A presented more grounded claims with cited evidence; Player B's assertions went unsupported.",
    argGraph: {
      nodes: [
        { id: "ca1", kind: "claim", owner: "a", text: "Player A opens with a specific claim.", round: 1 },
        { id: "ea1", kind: "evidence", owner: "a", text: "NREL data supports the cost trend.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
        { id: "ca2", kind: "claim", owner: "a", text: "Player A rebuts with a second claim.", round: 2 },
        { id: "ea2", kind: "evidence", owner: "a", text: "Reuters reporting backs the rebuttal.", round: 2, evidenceStrength: "cited", citations: [{ sourceName: "Reuters", homepage: "https://www.reuters.com" }] },
        { id: "cb1", kind: "claim", owner: "b", text: "Player B asserts the opposite.", round: 1 },
        { id: "cb2", kind: "claim", owner: "b", text: "Player B restates without support.", round: 2 },
      ],
      edges: [
        { from: "ea1", to: "ca1", relation: "supports" },
        { from: "ea2", to: "ca2", relation: "supports" },
        { from: "ca2", to: "cb1", relation: "rebuts" },
      ],
      dropped: [{ nodeId: "cb2", text: "Player B never answers the cost-trend evidence.", owner: "b", round: 2 }],
      contradictions: [],
      concessions: [],
      fallacies: [],
      evidenceStats: {
        total: 2,
        byOwner: { a: 2, b: 0, ai: 0 },
        byStrength: { anecdotal: 0, general: 0, cited: 2, strong: 0 },
        unsupportedClaimIds: ["cb1", "cb2"],
      },
      impactComparison: null,
    },
  };
}
