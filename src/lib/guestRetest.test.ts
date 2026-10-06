import { describe, expect, it } from "vitest";
import { assessGuestRepair, assessGuestRetest } from "./guestAssessment";

const OPPONENT =
  "A blanket rule sounds simple, but it can punish students who need a phone for accessibility, family care, or a safe trip home.";

describe("assessGuestRetest", () => {
  it("does not claim a retest happened when the drill never succeeded", () => {
    const outcome = assessGuestRetest("claim", false, "Schools should require a phone-free hour because attention is finite.");
    expect(outcome.demonstrated).toBe(false);
    expect(outcome.evidence).toBe("single_repair");
    expect(outcome.headline).toBe("Not retested yet");
  });

  it("reports an observed move when the retest carries the repaired skill", () => {
    const outcome = assessGuestRetest(
      "claim",
      true,
      "Schools should require a phone-free hour because attention is finite and notifications compete with it.",
      OPPONENT,
    );
    expect(outcome.demonstrated).toBe(true);
    expect(outcome.evidence).toBe("retest_in_debate");
    expect(outcome.headline).toContain("Observed in a live debate");
  });

  it("states the sample size rather than implying mastery", () => {
    const outcome = assessGuestRetest(
      "claim",
      true,
      "Schools should require a phone-free hour because attention is finite and notifications compete with it.",
      OPPONENT,
    );
    expect(outcome.detail).toContain("ONE observed instance");
    expect(outcome.detail.toLowerCase()).not.toContain("mastered your");
  });

  it("refuses to infer non-retention from a single missed round", () => {
    const outcome = assessGuestRetest("impact", true, "It is a good idea and people like it.", OPPONENT);
    expect(outcome.demonstrated).toBe(false);
    expect(outcome.detail).toContain("not proof");
  });

  it("agrees with the repair check it reuses, so the two can never diverge", () => {
    const rewrite =
      "The other side is right that a blanket rule hurts some pupils, but on balance the benefit is greater because teachers regain an hour of attention.";
    const repair = assessGuestRepair("impact", rewrite, OPPONENT);
    const retest = assessGuestRetest("impact", true, rewrite, OPPONENT);
    expect(retest.demonstrated).toBe(repair.succeeded);
  });
});
