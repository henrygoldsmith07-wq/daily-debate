import { describe, expect, it } from "vitest";
import { buildLoopChain } from "./loopChain";
import { buildWeaknessLibrary } from "./weaknessLibrary";

describe("buildWeaknessLibrary", () => {
  const chain = buildLoopChain(
    [
      { id: "a", targetKind: "evidence", createdAt: "2026-10-01T00:00:00Z", succeeded: true },
      { id: "b", targetKind: "evidence", createdAt: "2026-10-05T00:00:00Z", succeeded: true },
      { id: "c", targetKind: "logic", createdAt: "2026-10-03T00:00:00Z", succeeded: false },
    ],
    [
      { repairResultId: "a", assignedAt: "2026-10-02T00:00:00Z", completedAt: "2026-10-02T01:00:00Z", observable: true, demonstrated: true },
      { repairResultId: "b", assignedAt: "2026-10-06T00:00:00Z", completedAt: "2026-10-06T01:00:00Z", observable: true, demonstrated: false },
    ],
  );
  it("groups by skill, newest first, counts stages", () => {
    const lib = buildWeaknessLibrary(chain);
    expect(lib.map((g) => g.kind)).toEqual(["evidence", "logic"]);
    expect(lib[0].total).toBe(2);
    expect(lib[0].entries[0].repairId).toBe("b");
    expect(lib[0].byStage.retest_demonstrated).toBe(1);
    expect(lib[0].byStage.retest_not_demonstrated).toBe(1);
  });
  it("suggests re-drill only when latest did not land or show", () => {
    const lib = buildWeaknessLibrary(chain);
    expect(lib[0].redrillSuggested).toBe(true);
    expect(lib[1].redrillSuggested).toBe(true);
    const ok = buildWeaknessLibrary(chain.filter((e) => e.repairId === "a"));
    expect(ok[0].redrillSuggested).toBe(false);
  });
  it("empty chain gives empty library", () => expect(buildWeaknessLibrary([])).toEqual([]));
});
