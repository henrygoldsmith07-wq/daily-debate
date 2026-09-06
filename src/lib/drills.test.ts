import { describe, it, expect } from "vitest";
import { scoreDrillAttempt, drillsFor, type Drill } from "./drills";

const evidenceDrill: Drill = { id: "d-evidence", title: "Ground one claim", prompt: "Add a cited source.", focus: "evidence", minutes: 2 };
const clarityDrill: Drill = { id: "d-clarity", title: "Tighten it", prompt: "Rewrite in half the words.", focus: "clarity", minutes: 2 };
const rebuttalDrill: Drill = { id: "d-rebuttal", title: "Close a dropped thread", prompt: "Write the rebuttal.", focus: "rebuttal", minutes: 3 };

describe("scoreDrillAttempt (keyword-gaming removed)", () => {
  it("keyword stuffing no longer scores well", () => {
    // Under the old rubric this scored ~85: every focus bonus fired on single words.
    const stuffed =
      "according to source citation study data report http however outweigh matters more impact consequence strongest even if admittedly claim evidence rebuttal therefore because obviously everyone knows";
    const score = scoreDrillAttempt(evidenceDrill, stuffed);
    expect(score).toBeLessThanOrEqual(50);
  });

  it("a developed answer with a real citation outscores the stuffed one", () => {
    const genuine =
      "Solar generation costs fell below gas in most markets, per Lazard's 2024 levelised-cost analysis. Grid-scale battery prices dropped about 80% since 2013 (NREL), which changes the total-system comparison (https://www.nrel.gov).";
    expect(scoreDrillAttempt(evidenceDrill, genuine)).toBeGreaterThan(
      scoreDrillAttempt(evidenceDrill, "according to source study data report outweigh strongest"),
    );
  });

  it("evidence deliverable check requires a resolvable citation, not the word 'source'", () => {
    const withWord = "My source is a very long and detailed study that I read about this important topic which covers everything.";
    const withUrl = "The IEA's 2024 outlook puts solar 40% below gas: https://www.iea.org/reports/wco-2024.";
    expect(scoreDrillAttempt(evidenceDrill, withUrl)).toBeGreaterThan(scoreDrillAttempt(evidenceDrill, withWord));
  });

  it("rebuttal drill no longer awards points for the word 'however' alone", () => {
    const magic = "however however however you argue you claim you say opponent although but opponent however";
    expect(scoreDrillAttempt(rebuttalDrill, magic)).toBeLessThanOrEqual(50);
  });

  it("clarity brevity bonus still applies to genuinely short rewrites", () => {
    const short = "Costs fell; adoption rose quickly. Markets followed within two years.";
    expect(scoreDrillAttempt(clarityDrill, short)).toBeGreaterThan(40);
  });

  it("edge cases: empty and too-short attempts score zero", () => {
    expect(scoreDrillAttempt(evidenceDrill, "")).toBe(0);
    expect(scoreDrillAttempt(evidenceDrill, "short")).toBe(0);
  });
});

describe("drillsFor", () => {
  it("still assigns evidence drill for unsupported claims", () => {
    const drills = drillsFor({
      evidenceStats: { unsupportedClaimIds: ["c1"] },
      dropped: [],
      fallacies: [],
      impactComparison: { a: "x" },
    });
    expect(drills.map((d) => d.id)).toContain("d-evidence");
  });
});
