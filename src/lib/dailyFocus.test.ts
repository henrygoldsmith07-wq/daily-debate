import { describe, expect, it } from "vitest";
import { pickPriority, retestAgeDays, type PriorityInputs } from "./dailyFocus";

const base: PriorityInputs = {
  unfinishedRepair: null,
  dueRetest: null,
  openDrill: null,
  debateAvailable: true,
};

const repair = { debateId: "d5", label: "Evidence", nextCue: "name a specific source" };
const retest = { label: "Rebuttal" };
const drill = { title: "Answer the strongest argument" };

describe("pickPriority", () => {
  it("returns today's debate when nothing is unfinished", () => {
    const action = pickPriority(base);
    expect(action?.kind).toBe("debate");
  });

  it("returns null when there is nothing at all to do", () => {
    expect(pickPriority({ ...base, debateAvailable: false })).toBeNull();
  });

  it("puts an unresolved repair first", () => {
    const action = pickPriority({
      ...base,
      unfinishedRepair: repair,
      dueRetest: retest,
      openDrill: drill,
    });
    expect(action?.kind).toBe("repair");
    expect(action?.href).toBe("/debate/d5");
    expect(action?.title).toMatch(/evidence rewrite/i);
    expect(action?.detail).toContain("name a specific source");
  });

  it("puts a due retest above drills and today's debate without cueing the skill", () => {
    const action = pickPriority({
      ...base,
      dueRetest: retest,
      openDrill: drill,
    });
    expect(action?.kind).toBe("retest");
    expect(action?.href).toBe("/");
    // A pending retest reorders the day's actions but must not PROMPT the
    // behaviour the retest measures: the card may not name the skill under
    // test, and it may not announce that today is the test
    // (retestDisclosure.ts).
    expect(action?.title).not.toMatch(/rebuttal/i);
    expect(action?.detail).not.toMatch(/rebuttal/i);
    expect(action?.detail).not.toMatch(/today/i);
    expect(action?.detail).toMatch(/different topic/i);
    expect(action?.action).not.toMatch(/retest/i);
  });

  it("puts an active drill above today's debate", () => {
    const action = pickPriority({ ...base, openDrill: drill });
    expect(action?.kind).toBe("drill");
    expect(action?.title).toContain("Answer the strongest argument");
  });

  it("falls back to a plain detail line when the repair has no cue", () => {
    const action = pickPriority({ ...base, unfinishedRepair: { ...repair, nextCue: null } });
    expect(action?.detail).not.toContain("Next cue");
    expect(action?.detail).toMatch(/most valuable part/i);
  });

  it("produces exactly one action or none — never competing cards", () => {
    const action = pickPriority({
      ...base,
      unfinishedRepair: repair,
      dueRetest: retest,
      openDrill: drill,
      debateAvailable: true,
    });
    expect(action).not.toBeNull();
    expect(["repair", "retest", "drill", "debate"]).toContain(action!.kind);
  });
});

describe("pickPriority retest age", () => {
  const retestWithAge = (attemptedAt: string) => ({ label: "Rebuttal", attemptedAt });

  it("surfaces the age of a due retest so the nudge is auditable", () => {
    const action = pickPriority({
      ...base,
      dueRetest: retestWithAge("2026-09-01T12:00:00Z"),
    });
    expect(action?.kind).toBe("retest");
    expect(action?.detail).toMatch(/repaired a skill \d+ day/);
    expect(action?.detail).toMatch(/on a different topic/i);
  });

  it("falls back to the label-only detail when no attempt timestamp is supplied", () => {
    const action = pickPriority({ ...base, dueRetest: { label: "Rebuttal" } });
    expect(action?.detail).toBe(
      "You repaired a skill in an earlier debate. A later debate, on a different topic, is the test — and the skill and the day are never signposted.",
    );
  });

  it("never mislabels a future repair timestamp as a waited-for retest", () => {
    const action = pickPriority({ ...base, dueRetest: retestWithAge("2099-01-01T00:00:00Z") });
    // A future anchor cannot be a real "waiting" retest; degrade to the generic
    // phrasing rather than inventing a negative or misleading age.
    expect(action?.detail).toBe(
      "You repaired a skill in an earlier debate. A later debate, on a different topic, is the test — and the skill and the day are never signposted.",
    );
  });

  it("never ties the test to a specific day or a specific debate", () => {
    const action = pickPriority({ ...base, dueRetest: retestWithAge("2026-09-01T12:00:00Z") });
    // The product guarantees it does not signpost the skill or the day. It
    // must not overstate that into "the test is not signposted" either — a
    // loop the learner cannot see is a loop the learner cannot value.
    expect(action?.detail).toMatch(/never signposted/i);
    expect(action?.detail).not.toMatch(/it isn.t signposted/i);
    expect(action?.detail).not.toMatch(/\btoday\b/i);
    expect(action?.title).not.toMatch(/rebuttal|evidence|logic|clarity|impact/i);
  });
});

describe("retestAgeDays", () => {
  it("returns -1 for absent timestamps", () => {
    expect(retestAgeDays(null)).toBe(-1);
    expect(retestAgeDays(undefined)).toBe(-1);
    expect(retestAgeDays("")).toBe(-1);
  });

  it("returns -1 for unparseable input instead of NaN", () => {
    expect(retestAgeDays("not-a-date")).toBe(-1);
  });

  it("counts whole calendar days between the anchor and today", () => {
    const now = new Date();
    const past = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const age = retestAgeDays(past.toISOString());
    expect(age).toBeGreaterThanOrEqual(4);
    expect(age).toBeLessThanOrEqual(5);
  });
});
