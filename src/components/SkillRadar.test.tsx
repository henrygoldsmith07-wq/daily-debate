import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SkillRadar from "./SkillRadar";
import type { ArgumentSkillProfile } from "@/lib/skillProfile";

function profile(overrides: Partial<ArgumentSkillProfile> = {}): ArgumentSkillProfile {
  return {
    dimensions: [
      { key: "evidence", label: "Evidence", score: 80, lowConfidence: false, sampleSize: 6 },
      { key: "rebuttal", label: "Rebuttal", score: 40, lowConfidence: false, sampleSize: 6 },
      { key: "logic", label: "Logic", score: null, lowConfidence: true, sampleSize: 0 },
      { key: "impact", label: "Impact", score: 60, lowConfidence: true, sampleSize: 2 },
    ],
    debatesAnalysed: 6,
    minDebates: 3,
    overallScore: 60,
    ...overrides,
  } as ArgumentSkillProfile;
}

describe("SkillRadar", () => {
  it("draws one spoke and one marker per skill, with labels", () => {
    const html = renderToStaticMarkup(<SkillRadar profile={profile()} />);
    expect(html.match(/skill-radar-spoke/g)).toHaveLength(4);
    expect(html.match(/<circle/g)).toHaveLength(4);
    for (const label of ["Evidence", "Rebuttal", "Logic", "Impact"]) expect(html).toContain(label);
  });

  it("marks a skill with no observed signal as empty instead of guessing", () => {
    const html = renderToStaticMarkup(<SkillRadar profile={profile()} />);
    expect(html.match(/is-empty/g)).toHaveLength(1);
  });

  it("dashes the shape and says so while the profile is an early read", () => {
    const html = renderToStaticMarkup(<SkillRadar profile={profile({ debatesAnalysed: 1 })} />);
    expect(html).toContain("skill-radar-shape is-early");
    expect(html).toContain("early read");
  });

  it("prints no scores or percentages", () => {
    const html = renderToStaticMarkup(<SkillRadar profile={profile()} />);
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/\d+\s*%|\b(80|40|60)\b/);
  });
});
