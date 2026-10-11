import { describe, expect, it } from "vitest";

import { NAMES_OPPOSING_MOVE_RE, EXPLAINS_ANSWER_RE, readEngagementSignals } from "./engagementSignals";

// The engagement signal set shared by the drill rubric (adaptiveCoach) and the
// repair rubric (argumentRepair). It must read "answered the move the opponent
// actually made" and nothing else — in particular it must not accept a bare
// contrastive conjunction, which engages nothing.

describe("engagementSignals — naming the opposing move", () => {
  it("accepts a specific reference to the other side's argument", () => {
    expect(NAMES_OPPOSING_MOVE_RE.test("Their claim assumes a fixed budget.")).toBe(true);
    expect(NAMES_OPPOSING_MOVE_RE.test("That argument ignores the scaling evidence.")).toBe(true);
    expect(NAMES_OPPOSING_MOVE_RE.test("The objection only holds for small districts.")).toBe(true);
    expect(NAMES_OPPOSING_MOVE_RE.test("You argue that tutoring is cheaper per dollar.")).toBe(true);
  });

  it("rejects a contrastive conjunction with no reference to a move", () => {
    // "However, my policy is better" contrasts nothing — the old readability
    // rule could not tell the difference, which is why it mis-scored drills.
    expect(NAMES_OPPOSING_MOVE_RE.test("However, my policy is better.")).toBe(false);
    expect(NAMES_OPPOSING_MOVE_RE.test("But although we should act, costs matter.")).toBe(false);
    expect(NAMES_OPPOSING_MOVE_RE.test("My claim is that smaller classes work.")).toBe(false);
  });
});

describe("engagementSignals — explaining why the answer follows", () => {
  it("accepts a reasoning or validity marker", () => {
    expect(EXPLAINS_ANSWER_RE.test("...because the trial never tested both.")).toBe(true);
    expect(EXPLAINS_ANSWER_RE.test("...so their conclusion does not follow.")).toBe(true);
    expect(EXPLAINS_ANSWER_RE.test("...which means the comparison fails.")).toBe(true);
  });

  it("rejects a bare assertion", () => {
    expect(EXPLAINS_ANSWER_RE.test("They are simply wrong about this.")).toBe(false);
    expect(EXPLAINS_ANSWER_RE.test("My position is the correct one.")).toBe(false);
  });
});

describe("engagementSignals — the combined reading", () => {
  it("requires BOTH halves; either alone is not an engagement move", () => {
    expect(readEngagementSignals("Their claim is wrong.").engaged).toBe(false);
    expect(readEngagementSignals("This is true because costs fall.").engaged).toBe(false);
    expect(
      readEngagementSignals("Their claim assumes a fixed budget, which is not what the trial tested, so it does not settle the question.")
        .engaged,
    ).toBe(true);
  });

  it("reports which half is missing so callers can coach it", () => {
    expect(readEngagementSignals("Their claim is wrong.")).toMatchObject({ namesMove: true, explainsAnswer: false });
    expect(readEngagementSignals("Costs fall because scale improves.")).toMatchObject({ namesMove: false, explainsAnswer: true });
  });
});
