import { describe, expect, it } from "vitest";
import { emptyGraph, type ArgGraph } from "./argGraph";
import { pickRepairTarget, repairForArgumentRole, repairPathForRole, repairStateFromScore, scoreRepair } from "./argumentRepair";

function graph(overrides: Partial<ArgGraph>): ArgGraph {
  return {
    ...emptyGraph(),
    nodes: [
      { id: "a1", kind: "claim", owner: "a", text: "The policy improves access.", round: 1 },
      { id: "ai1", kind: "counterclaim", owner: "ai", text: "The policy creates a costly trade-off.", round: 1 },
    ],
    ...overrides,
  };
}

describe("argument repair targets", () => {
  it("maps classifier roles to specialised repair paths", () => {
    expect(repairPathForRole("evidence")).toBe("evidence-verification");
    expect(repairPathForRole("rebuttal")).toBe("rebuttal-compare");
    expect(repairPathForRole("question")).toBe("question-clarification");
    expect(repairPathForRole("off-topic")).toBe("off-topic-lightweight");
  });

  it("uses earlier-opportunity facts when routing a rebuttal repair", () => {
    const target = repairForArgumentRole(graph({
      nodes: [
        { id: "a1", kind: "claim", owner: "a", text: "The policy improves access.", round: 1 },
        { id: "b1", kind: "counterclaim", owner: "ai", text: "The policy creates a costly trade-off.", round: 1 },
        { id: "a2", kind: "claim", owner: "a", text: "The policy also reduces cost.", round: 2 },
      ],
    }), "rebuttal");
    expect(target?.kind).toBe("rebuttal");
    expect(target?.sourceNodeId).toBe("b1");
  });

  it("prioritises an unsupported claim and scores a named source", () => {
    const target = pickRepairTarget(graph({ evidenceStats: { ...emptyGraph().evidenceStats, unsupportedClaimIds: ["a1"] } }));
    expect(target?.kind).toBe("evidence");
    expect(target?.sourceNodeId).toBe("a1");
    const result = scoreRepair(target!, "Pew Research Center reported in 2025 that the access gap fell by 12 percent, which supports the policy because fewer low-income students remained excluded.");
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.state).toBe("repair_demonstrated");
    expect(result.signals).toContain("names a specific source");
  });

  it("finds a user's fallacy before offering a generic rewrite", () => {
    const target = pickRepairTarget(graph({
      nodes: [
        { id: "a1", kind: "claim", owner: "a", text: "Everyone knows this policy works, so it must be adopted.", round: 1 },
        { id: "ai1", kind: "counterclaim", owner: "ai", text: "There are implementation costs.", round: 1 },
      ],
      fallacies: [{ nodeId: "a1", fallacy: "appeal_to_authority", note: "shortcut" }],
    }));
    expect(target?.kind).toBe("logic");
    expect(target?.label).toContain("appeal to authority");
  });

  it("selects an unanswered eligible opposing move when the user's graph is otherwise clean", () => {
    // ai1 (round 1) is an ELIGIBLE opportunity: the user has a later node
    // (a2, round 2) and never validly answered it.
    const target = pickRepairTarget(graph({
      nodes: [
        { id: "a1", kind: "claim", owner: "a", text: "The policy improves access.", round: 1 },
        { id: "ai1", kind: "counterclaim", owner: "ai", text: "The policy creates a costly trade-off.", round: 1 },
        { id: "a2", kind: "claim", owner: "a", text: "The policy also reduces cost.", round: 2 },
      ],
    }));
    expect(target?.kind).toBe("rebuttal");
    expect(target?.sourceNodeId).toBe("ai1");
  });

  it("does not offer a rebuttal repair when the opposing move was never answerable", () => {
    // No later user node exists after ai1, so there is no rebuttal
    // opportunity at all: the repair falls through to other kinds instead
    // of blaming the user for something they had no turn to answer.
    const target = pickRepairTarget(graph({
      nodes: [
        { id: "a1", kind: "claim", owner: "a", text: "The policy improves access.", round: 1 },
        { id: "ai1", kind: "counterclaim", owner: "ai", text: "The policy creates a costly trade-off.", round: 1 },
      ],
    }));
    expect(target?.kind).not.toBe("rebuttal");
  });

  it("an invalid answer (self-target) does not hide the unanswered opposing move", () => {
    // The user's rebuttal targets their own claim: the canonical rule
    // ignores it, so ai1 stays an unanswered eligible opportunity.
    const target = pickRepairTarget(graph({
      nodes: [
        { id: "a1", kind: "claim", owner: "a", text: "The policy improves access.", round: 1 },
        { id: "ai1", kind: "counterclaim", owner: "ai", text: "The policy creates a costly trade-off.", round: 1 },
        { id: "r1", kind: "rebuttal", owner: "a", text: "Bad self-targeting answer.", round: 2, targets: ["a1"] },
      ],
    }));
    expect(target?.kind).toBe("rebuttal");
    expect(target?.sourceNodeId).toBe("ai1");
  });

  it.each([
    "The policy helps because access improves. Therefore it deserves consideration for the families currently excluded from services.",
    "  THE POLICY HELPS BECAUSE ACCESS IMPROVES! Therefore it deserves consideration for the families currently excluded from services?  ",
  ])("does not credit copying the original move: %s", (rewrite) => {
    const target = {
      kind: "logic" as const, label: "Logic", title: "Repair", prompt: "",
      sourceText: "The policy helps because access improves. Therefore it deserves consideration for the families currently excluded from services.",
    };
    expect(scoreRepair(target, rewrite).score).toBe(0);
    expect(scoreRepair(target, rewrite).signals.join(" ")).toMatch(/change|revise/i);
  });

  it("gives actionable signals when a repair is missing its key move", () => {
    const target = { kind: "impact" as const, label: "Impact", title: "Name what changes", prompt: "", sourceText: "The policy changes access." };
    const result = scoreRepair(target, "The policy changes access.");
    expect(result.score).toBeLessThan(60);
    expect(result.signals.some((signal) => signal.includes("both competing outcomes"))).toBe(true);
  });

  it("maps the internal threshold to formative learner states", () => {
    expect(repairStateFromScore(0)).toBe("needs_another_pass");
    expect(repairStateFromScore(30)).toBe("partially_repaired");
    expect(repairStateFromScore(59)).toBe("partially_repaired");
    expect(repairStateFromScore(60)).toBe("repair_demonstrated");
  });

  describe("adversarial anti-gaming checks", () => {
    it("rejects a fake rebuttal made of contrast/reasoning keywords with no target engagement", () => {
      const target = {
        kind: "rebuttal" as const,
        label: "Rebuttal",
        title: "Repair",
        prompt: "",
        sourceText: "The policy creates a costly trade-off for rural hospitals.",
      };
      const result = scoreRepair(target, "However because therefore this matters. Even if however, because therefore the point still matters more.");
      expect(result.score).toBeLessThan(60);
      expect(result.state).not.toBe("repair_demonstrated");
      expect(result.signals.join(" ")).toMatch(/actual opposing claim|substance/i);
    });

    it("accepts a rebuttal only when it engages the target and explains the consequence", () => {
      const target = {
        kind: "rebuttal" as const,
        label: "Rebuttal",
        title: "Repair",
        prompt: "",
        sourceText: "The policy creates a costly trade-off for rural hospitals.",
      };
      const result = scoreRepair(target, "The costly trade-off for rural hospitals is real, but it assumes every hospital bears the same implementation cost because targeted grants would absorb the transition cost for the smallest hospitals.");
      expect(result.score).toBeGreaterThanOrEqual(60);
      expect(result.state).toBe("repair_demonstrated");
    });

    it("rejects vague evidence language even when it stuffs study/report/research cues", () => {
      const target = {
        kind: "evidence" as const,
        label: "Evidence",
        title: "Repair",
        prompt: "",
        sourceText: "The policy improves access.",
      };
      const result = scoreRepair(target, "According to a study and a research report, data shows the policy works because therefore access is better for everyone.");
      expect(result.score).toBeLessThan(60);
      expect(result.signals.join(" ")).toMatch(/specific source/i);
    });

    it("rejects an impact answer that says 'matters more' without comparing two outcomes", () => {
      const target = {
        kind: "impact" as const,
        label: "Impact",
        title: "Repair",
        prompt: "",
        sourceText: "The policy changes access.",
      };
      const result = scoreRepair(target, "This matters more because it matters more. Therefore the bigger impact matters more for the decision and should be prioritised.");
      expect(result.score).toBeLessThan(60);
      expect(result.signals.join(" ")).toMatch(/both competing outcomes/i);
    });

    it("rejects reasoning-marker stuffing without two distinct propositions", () => {
      const target = {
        kind: "logic" as const,
        label: "Logic",
        title: "Repair",
        prompt: "",
        sourceText: "The policy is obviously best.",
      };
      const result = scoreRepair(target, "Because therefore because therefore because therefore. This is the reason because therefore.");
      expect(result.score).toBeLessThan(60);
      expect(result.signals.join(" ")).toMatch(/distinct reason|distinct propositions/i);
    });

    it("caps keyword-dense nonsense even when it names the target and includes bridge markers", () => {
      const target = {
        kind: "rebuttal" as const,
        label: "Rebuttal",
        title: "Repair",
        prompt: "",
        sourceText: "The policy creates a costly trade-off for rural hospitals.",
      };
      const result = scoreRepair(
        target,
        "Rural hospitals face a costly trade-off; however because therefore however because the policy matters more, therefore rural hospitals however because costs matter more.",
      );
      expect(result.state).not.toBe("repair_demonstrated");
      expect(result.signals.join(" ")).toMatch(/cue words|substantive content/i);
    });

    it("accepts a specific named source that is not hard-coded in the source allowlist", () => {
      const target = {
        kind: "evidence" as const,
        label: "Evidence",
        title: "Repair",
        prompt: "",
        sourceText: "The programme improves attendance.",
      };
      const result = scoreRepair(
        target,
        "According to Cardiff University, attendance increased by 11% in 2025, which supports the programme because fewer pupils missed scheduled lessons.",
      );
      expect(result.state).toBe("repair_demonstrated");
      expect(result.signals).toContain("names a specific source");
    });
  });
});
