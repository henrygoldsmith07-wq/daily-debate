import { describe, expect, it } from "vitest";
import {
  buildPoliticalIdentifier,
  isStancePosition,
  POLITICAL_ID_MIN_POSITIONS,
  type StancePosition,
  type StanceRecord,
} from "./politicalIdentifier";

const REQUIRED_CAVEAT = "a pattern of the positions you've taken, not a measure of your beliefs.";
const MIN = POLITICAL_ID_MIN_POSITIONS;

function row(position: StancePosition, category: string | null = null): StanceRecord {
  return { category, position };
}

function many(position: StancePosition, count: number, category: string | null = null): StanceRecord[] {
  return Array.from({ length: count }, () => row(position, category));
}

function split(forCount: number, againstCount: number, category: string | null = "Economics"): StanceRecord[] {
  return [...many("for", forCount, category), ...many("against", againstCount, category)];
}

describe("buildPoliticalIdentifier — insufficient evidence", () => {
  it.each([
    { label: "empty", rows: [] as StanceRecord[] },
    { label: "one stance", rows: split(1, 0) },
    { label: "just below the threshold", rows: split(4, MIN - 1 - 4) },
  ])("says nothing about lean for $label", ({ rows }) => {
    const model = buildPoliticalIdentifier(rows);
    expect(model.state).toBe("insufficient_evidence");
    expect(model.total).toBe(rows.length);
    expect(model.needed).toBe(MIN);
    expect(model.lean).toBeNull();
    expect(model.forShare).toBeNull();
    expect(model.categories).toEqual([]);
    expect(model.verdict).toBeNull();
    expect(model.note).toContain(REQUIRED_CAVEAT);
  });

  it("flips to a real read exactly at the threshold", () => {
    expect(buildPoliticalIdentifier(split(4, MIN - 1 - 4)).state).toBe("insufficient_evidence");
    expect(buildPoliticalIdentifier(split(4, MIN - 4)).state).toBe("ok");
  });
});

describe("buildPoliticalIdentifier — category normalization", () => {
  it("groups null, empty and whitespace categories as 'other' and lowercases keys", () => {
    const rows: StanceRecord[] = [
      ...many("for", 2, null),
      ...many("against", 2, ""),
      ...many("for", 1, "   "),
      ...many("against", 1, "Economics"),
      ...many("for", 1, " eCONOMICS "),
      ...many("against", 1, "ECONOMICS"),
    ];
    const model = buildPoliticalIdentifier(rows);

    expect(model.state).toBe("ok");
    expect(model.categories.map((c) => c.key)).toEqual(["other", "economics"]);
    expect(model.categories.map((c) => c.label)).toEqual(["Other", "Economics"]);
    expect(model.categories.find((c) => c.key === "economics")).toMatchObject({
      forCount: 1,
      againstCount: 2,
      total: 3,
      forShare: 33,
    });
    expect(model.categories.find((c) => c.key === "other")).toMatchObject({
      forCount: 3,
      againstCount: 2,
      total: 5,
      forShare: 60,
    });
    expect(model.total).toBe(8);
  });

  it("preserves a readable label from the first non-empty category value", () => {
    const rows: StanceRecord[] = [...many("for", 5, "Civics"), ...many("for", 5, " civics ")];
    const model = buildPoliticalIdentifier(rows);
    expect(model.categories).toHaveLength(1);
    expect(model.categories[0]).toMatchObject({ key: "civics", label: "Civics" });
  });
});

describe("buildPoliticalIdentifier — lean boundaries", () => {
  it.each([
    { label: "60 is for", forCount: 6, againstCount: 4, lean: "for", forShare: 60 },
    { label: "63 is for", forCount: 5, againstCount: 3, lean: "for", forShare: 63 },
    { label: "50 is mixed", forCount: 5, againstCount: 5, lean: "mixed", forShare: 50 },
    { label: "41 is mixed", forCount: 41, againstCount: 59, lean: "mixed", forShare: 41 },
    { label: "40 is against", forCount: 4, againstCount: 6, lean: "against", forShare: 40 },
    { label: "38 is against", forCount: 3, againstCount: 5, lean: "against", forShare: 38 },
  ] as const)("$label", ({ forCount, againstCount, lean, forShare }) => {
    const model = buildPoliticalIdentifier(split(forCount, againstCount));
    expect(model.lean).toBe(lean);
    expect(model.forShare).toBe(forShare);
  });
});

describe("buildPoliticalIdentifier — verdict copy", () => {
  it.each([
    {
      lean: "for",
      rows: split(6, 2),
      verdict: "You argued For more often than Against. Your most active topic was economics.",
    },
    {
      lean: "against",
      rows: split(2, 6),
      verdict: "You argued Against more often than For. Your most active topic was economics.",
    },
    {
      lean: "mixed",
      rows: split(4, 4),
      verdict: "You argued For and Against about evenly — no clear tilt in the positions you've taken. Your most active topic was economics.",
    },
  ] as const)("describes the $lean lean as a pattern of choices", ({ rows, verdict }) => {
    const model = buildPoliticalIdentifier(rows);
    expect(model.verdict).toBe(verdict);
    // Never a belief, personality, or validated-science claim, and never an
    // inference that "For" means support for change.
    expect(model.verdict!.toLowerCase()).not.toMatch(/you believe|your beliefs are|you are (a|an) |personality|validated|for change|against change/);
  });

  it("names the 'other' bucket honestly when no real category was given", () => {
    const model = buildPoliticalIdentifier(split(6, 2, null));
    expect(model.verdict).toBe("You argued For more often than Against. Your most active topic was other.");
  });

  it("does not imply the lean is clearest in the busiest topic", () => {
    // Economics is the busiest category but leans Against, while overall lean
    // is For. "Most clearly on economics" would misdescribe the record.
    const rows: StanceRecord[] = [
      ...many("against", 6, "Economics"),
      ...many("for", 2, "Economics"),
      ...many("for", 8, "Health"),
    ];
    const model = buildPoliticalIdentifier(rows);
    expect(model.lean).toBe("for");
    expect(model.categories[0].label).toBe("Economics");
    expect(model.verdict).not.toContain("Most clearly on economics");
    expect(model.verdict).toContain("Your most active topic was economics.");
  });

  it("does not call a topic 'most active' from a single stray position", () => {
    const rows: StanceRecord[] = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"]
      .map((category) => ({ category, position: "for" as const }));
    const model = buildPoliticalIdentifier(rows);
    expect(model.verdict).toBe("You argued For more often than Against.");
    expect(model.verdict).not.toContain("most active");
  });
});

describe("buildPoliticalIdentifier — sorting", () => {
  it("orders categories by total desc, then key asc", () => {
    const rows: StanceRecord[] = [
      ...many("for", 3, "beta"),
      ...many("against", 1, "beta"),
      ...many("for", 2, "alpha"),
      ...many("against", 2, "alpha"),
      ...many("for", 1, "gamma"),
      ...many("against", 1, "gamma"),
      ...many("for", 1, null),
    ];
    const model = buildPoliticalIdentifier(rows);
    expect(model.categories.map((c) => c.key)).toEqual(["alpha", "beta", "gamma", "other"]);
    expect(model.categories.map((c) => c.total)).toEqual([4, 4, 2, 1]);
  });

  it("exposes per-category for/against counts and rounded share", () => {
    const rows: StanceRecord[] = [
      ...many("for", 1, "Economics"),
      ...many("against", 2, "Economics"),
      ...many("for", 5, null),
    ];
    const economics = buildPoliticalIdentifier(rows).categories.find((c) => c.key === "economics");
    expect(economics).toEqual({
      key: "economics",
      label: "Economics",
      forCount: 1,
      againstCount: 2,
      total: 3,
      forShare: 33,
    });
  });
});

describe("buildPoliticalIdentifier — note", () => {
  it("attaches the same honest caveat in both states", () => {
    const insufficient = buildPoliticalIdentifier(split(1, 0));
    const ok = buildPoliticalIdentifier(split(4, 4));
    expect(insufficient.note).toBe(ok.note);
    expect(ok.note).toContain(REQUIRED_CAVEAT);
    expect(ok.note.toLowerCase()).not.toMatch(/validated political science|your personality/);
  });
});

describe("isStancePosition guard", () => {
  it.each([
    { value: "for", valid: true },
    { value: "against", valid: true },
    { value: "FOR", valid: false },
    { value: "abstain", valid: false },
    { value: "", valid: false },
    { value: null, valid: false },
    { value: undefined, valid: false },
    { value: 1, valid: false },
  ])("accepts only for/against: $value", ({ value, valid }) => {
    expect(isStancePosition(value)).toBe(valid);
  });

  it("ignores invalid positions before building (as the loader does)", () => {
    const raw: unknown[] = ["for", "against", "abstain", null, "FOR", "for", "against", "for"];
    const records = raw.filter(isStancePosition).map((position) => row(position, "Economics"));
    expect(records).toHaveLength(5);
    const model = buildPoliticalIdentifier(records);
    expect(model.state).toBe("insufficient_evidence");
    expect(model.total).toBe(5);

    const withEnough = [...raw, "for", "against", "for"].filter(isStancePosition).map((position) => row(position, "Economics"));
    expect(withEnough).toHaveLength(8);
    expect(buildPoliticalIdentifier(withEnough).total).toBe(8);
  });
});
