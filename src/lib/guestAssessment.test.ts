import { describe, expect, it } from "vitest";
import {
  assessGuestPractice,
  assessGuestRepair,
  assessGuestResponse,
  inspectGuestResponse,
} from "./guestAssessment";

const OPPONENTS = [
  "A phone-free hour gives students room to focus, talk, and reset without another notification competing for attention.",
  "A blanket rule sounds simple, but it can punish students who need a phone for accessibility, family care, or a safe trip home.",
  "The best policy is not the strictest one. It is the one students can follow while teachers can still protect learning time.",
];

describe("inspectGuestResponse", () => {
  it("detects observable reasoning features without inventing a score", () => {
    const signals = inspectGuestResponse(
      "Schools should keep a phone-free hour because constant notifications interrupt concentration and make lessons harder to follow.",
      OPPONENTS[0],
    );

    expect(signals.hasClaim).toBe(true);
    expect(signals.hasReasoning).toBe(true);
    expect(signals.namesEvidence).toBe(false);
  });

  it("does not reward keyword stuffing as rebuttal", () => {
    const signals = inspectGuestResponse("However.", OPPONENTS[1]);
    expect(signals.addressesOpponent).toBe(false);
    expect(signals.hasReasoning).toBe(false);
  });

  it("recognises a named source rather than the word evidence alone", () => {
    expect(
      inspectGuestResponse(
        "According to UNESCO research, limiting interruptions can improve learning because students spend more time on task.",
        OPPONENTS[0],
      ).namesEvidence,
    ).toBe(true);

    expect(
      inspectGuestResponse(
        "There is evidence because this policy is clearly better for students overall.",
        OPPONENTS[0],
      ).namesEvidence,
    ).toBe(false);
  });
});

describe("assessGuestResponse", () => {
  it("changes the coaching note based on what the user actually wrote", () => {
    const weak = assessGuestResponse(
      "Phone-free time is better for schools and students.",
      OPPONENTS[0],
      0,
    );
    expect(weak.nextMove).toMatch(/reason/i);

    const stronger = assessGuestResponse(
      "Schools should use a phone-free hour because fewer notifications make it easier to focus during lessons.",
      OPPONENTS[0],
      0,
    );
    expect(stronger.strength).toMatch(/reason/i);
    expect(stronger.nextMove).toMatch(/source|study|report|dataset/i);
  });
});

describe("assessGuestPractice", () => {
  it("selects one evidence weakness when the practice contains no named support", () => {
    const result = assessGuestPractice(
      [
        "Schools should use a phone-free hour because fewer notifications make lessons easier to follow.",
        "However, accessibility and family care are real concerns, but schools can allow exceptions because the rule only needs to protect normal lesson time.",
        "On balance, focused learning matters more than convenience because students can still access phones outside the protected hour.",
      ],
      OPPONENTS,
    );

    expect(result.weakness.kind).toBe("evidence");
    expect(result.counts.evidence).toBe(0);
    expect(result.note).toMatch(/not a debate score/i);
  });

  it("moves to rebuttal when evidence exists but the opponent is not answered", () => {
    const result = assessGuestPractice(
      [
        "According to UNESCO research, schools should reduce phone interruptions because focused lesson time supports learning.",
        "Schools should keep the rule because concentration matters for students and teachers in normal lessons.",
        "On balance, learning matters more than convenience because the policy can keep exceptions for genuine needs.",
      ],
      OPPONENTS,
    );

    expect(result.weakness.kind).toBe("rebuttal");
    expect(result.sourceResponseIndex).toBe(1);
  });

  it("keeps the repair source valid even when every response names evidence", () => {
    const result = assessGuestPractice(
      [
        "According to UNESCO research, schools should use a phone-free hour because fewer notifications can protect focused learning time.",
        "However, accessibility and family care are real concerns, but OECD data suggests clear exceptions can preserve access because the rule targets ordinary lesson time.",
        "On balance, NFER research suggests focused learning matters more than convenience because students can still use phones outside the protected hour.",
      ],
      OPPONENTS,
    );

    expect(result.sourceResponseIndex).toBeGreaterThanOrEqual(0);
    expect(result.sourceResponseIndex).toBeLessThan(3);
    expect(result.sourceResponse).not.toBe("");
  });
});

describe("assessGuestRepair", () => {
  it("requires substance as well as the target move", () => {
    expect(assessGuestRepair("impact", "Matters more.").succeeded).toBe(false);

    const repaired = assessGuestRepair(
      "impact",
      "On balance, protected learning time matters more than convenience because students can still use phones outside the hour while every lesson benefits from fewer interruptions.",
    );
    expect(repaired.succeeded).toBe(true);
  });

  it("accepts a named-source repair only when it also explains the support", () => {
    expect(
      assessGuestRepair(
        "evidence",
        "According to UNESCO, this policy is better for schools.",
      ).succeeded,
    ).toBe(false);

    expect(
      assessGuestRepair(
        "evidence",
        "According to UNESCO research, reducing interruptions can improve learning because students spend more time focused on the lesson.",
      ).succeeded,
    ).toBe(true);
  });
});
