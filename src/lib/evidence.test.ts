import { describe, expect, it } from "vitest";
import { extractEvidenceUrls, inferSourceFromUrl, inspectSubmittedEvidence, validateUserEvidence } from "./evidence";

describe("submitted evidence inspection", () => {
  it("extracts and validates https sources without treating them as proof", () => {
    const inspection = inspectSubmittedEvidence("According to NREL data, costs fell. https://www.nrel.gov/research/report.");
    expect(inspection.status).toBe("verifiable");
    expect(inspection.urls).toEqual(["https://www.nrel.gov/research/report"]);
    expect(inspection.sources[0].sourceName).toBe("NREL");
    expect(inferSourceFromUrl("https://www.nrel.gov/research/report")).toBe("NREL");
  });

  it("distinguishes an evidence cue that still needs a source", () => {
    const inspection = inspectSubmittedEvidence("A study shows that the policy works.");
    expect(inspection.status).toBe("needs-source");
    expect(inspection.hasEvidenceCue).toBe(true);
  });

  it("returns invalid for non-https source URLs", () => {
    const inspection = inspectSubmittedEvidence("See http://example.com/report for the data.");
    expect(extractEvidenceUrls("See http://example.com/report")).toEqual([]);
    expect(inspection.status).toBe("needs-source");
    expect(validateUserEvidence({ url: "http://example.com/report" })).toContain("url must be https");
  });
});
