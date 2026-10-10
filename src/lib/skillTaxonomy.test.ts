import { describe, expect, it } from "vitest";

import { METRIC_KEYS } from "./skillLedger";
import {
  type SkillDimensionKey,
  SKILL_DIMENSION_KEYS,
  SKILL_DIMENSIONS,
  canonicalSkillKey,
  canonicalSkillLabel,
  evidenceLevelForSkill,
  metricGoodness,
  metricsForSkill,
  skillForMetric,
  skillKeyForRepairKind,
} from "./skillTaxonomy";

describe("skillTaxonomy — canonical coverage", () => {
  it("groups all 13 MetricKeys exactly once (no double-counted or orphaned signal)", () => {
    const grouped = SKILL_DIMENSION_KEYS.flatMap((k) => SKILL_DIMENSIONS[k].metrics).sort();
    expect(grouped).toEqual([...METRIC_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("every signal maps back to the skill that owns it", () => {
    for (const metric of METRIC_KEYS) {
      const skill = skillForMetric(metric);
      expect(metricsForSkill(skill)).toContain(metric);
    }
  });

  it("exposes exactly seven skills in stable order", () => {
    expect(SKILL_DIMENSION_KEYS).toEqual([
      "evidence",
      "rebuttal",
      "logic",
      "clarity",
      "impact",
      "steelmanning",
      "structure",
    ]);
    // Every metric is a plain string key of its skill definition.
    for (const key of SKILL_DIMENSION_KEYS) {
      expect(SKILL_DIMENSIONS[key].key).toBe(key);
      expect(SKILL_DIMENSIONS[key].label.length).toBeGreaterThan(0);
      expect(SKILL_DIMENSIONS[key].metrics.length).toBeGreaterThan(0);
    }
  });

  it("labels are unique across skills", () => {
    const labels = SKILL_DIMENSION_KEYS.map((k) => SKILL_DIMENSIONS[k].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("aliases never overlap across skills or repeat the canonical label", () => {
    // "engagement" was previously claimed by both clarity (as its learner-facing
    // label) and rebuttal (as an alias), so canonicalSkillKey silently mis-filed
    // it. This pins the crosswalk: every alias resolves to exactly one skill, and
    // every alias resolves to the skill that owns it.
    const seen = new Map<string, SkillDimensionKey>();
    for (const key of SKILL_DIMENSION_KEYS) {
      for (const alias of SKILL_DIMENSIONS[key].aliases) {
        const norm = alias.replace(/[\s_-]+/g, "").toLowerCase();
        if (seen.has(norm) && seen.get(norm) !== key) {
          throw new Error(`alias "${alias}" resolves to both ${seen.get(norm)} and ${key}`);
        }
        seen.set(norm, key);
      }
    }
    // Cross-check the switch resolves every alias to its owning skill.
    for (const [alias, expected] of seen.entries()) {
      expect(canonicalSkillKey(alias)).toBe(expected);
    }
  });
});

describe("skillTaxonomy — legacy crosswalk", () => {
  it("normalises legacy CoachDimension / ProfileDimensionKey / RepairKind terms", () => {
    expect(canonicalSkillKey("reasoning")).toBe("logic");
    expect(canonicalSkillKey("claim-clarity")).toBe("clarity");
    expect(canonicalSkillKey("Claim clarity")).toBe("clarity");
    expect(canonicalSkillKey("weighing")).toBe("impact");
    expect(canonicalSkillKey("delivery")).toBe("structure");
    expect(canonicalSkillKey("steelman quality")).toBe("steelmanning");
    expect(canonicalSkillKey("evidence support")).toBe("evidence");
    expect(canonicalSkillKey("engagement")).toBe("clarity");
  });


  it("returns null for unknown terms instead of silently mis-filing", () => {
    expect(canonicalSkillKey("nonsense-term")).toBeNull();
    expect(canonicalSkillKey(null)).toBeNull();
    expect(canonicalSkillKey(undefined)).toBeNull();
  });

  it("maps repair kinds to their target skill", () => {
    expect(skillKeyForRepairKind("evidence")).toBe("evidence");
    expect(skillKeyForRepairKind("logic")).toBe("logic");
    expect(skillKeyForRepairKind("clarity")).toBe("clarity");
    expect(skillKeyForRepairKind("not-a-kind")).toBeNull();
  });

  it("renders a label for every legacy term, falling back to the raw term", () => {
    expect(canonicalSkillLabel("delivery")).toBe("Structure");
    expect(canonicalSkillLabel("reasoning")).toBe("Logic");
    expect(canonicalSkillLabel("mystery")).toBe("mystery");
  });
});

describe("skillTaxonomy — evidence levels and normalisation", () => {
  it("never labels a model-extracted skill as purely observed", () => {
    // steelmanning is backed only by model-extracted steelman quality.
    expect(evidenceLevelForSkill("steelmanning")).toBe("extracted");
    // evidence is backed only by counted moves.
    expect(evidenceLevelForSkill("evidence")).toBe("observed");
  });

  it("inverts lower-is-better metrics so higher goodness always means better", () => {
    // unsupportedClaimRate is lower-is-better: 0.0 is perfect.
    expect(metricGoodness(0, "unsupportedClaimRate")).toBe(1);
    expect(metricGoodness(1, "unsupportedClaimRate")).toBe(0);
    // rebuttalCoverage is higher-is-better.
    expect(metricGoodness(0.8, "rebuttalCoverage")).toBeCloseTo(0.8);
    // missing data stays missing, never a zero.
    expect(metricGoodness(null, "clarity")).toBeNull();
    expect(metricGoodness(undefined, "clarity")).toBeNull();
  });
});
