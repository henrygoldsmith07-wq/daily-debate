import { describe, it, expect } from "vitest";
import { assignCorpusSplit } from "./corpusSplit";
import type { SplitInput } from "./corpusSplit";

describe("assignCorpusSplit family stratum", () => {
  it("uses the first member's attributes as the whole family's stratum", () => {
    // Both members share a familyKey but carry differing attributes, so the
    // stratum assigned to every member reveals which member's rule was used.
    const items: SplitInput[] = [
      { id: "a1", familyKey: "fam", topic: "energy", dynamicsTier: "high", lengthBucket: "long" },
      { id: "a2", familyKey: "fam", topic: "health", dynamicsTier: "low", lengthBucket: "short" },
    ];

    const manifest = assignCorpusSplit(items);
    const firstMemberStratum = "energy/high/long";
    const secondMemberStratum = "health/low/short";

    expect(manifest.assignments).toHaveLength(2);
    for (const assignment of manifest.assignments) {
      expect(assignment.familyKey).toBe("fam");
      // Documented rule: the family's stratum comes from its FIRST member.
      expect(assignment.stratum).toBe(firstMemberStratum);
      expect(assignment.stratum).not.toBe(secondMemberStratum);
    }
  });
});
