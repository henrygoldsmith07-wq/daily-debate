import { describe, expect, it } from "vitest";
import { buildWeeklyLoop } from "./weeklyLoop";
import { buildWeeklyRecap } from "./weeklyRecap";

const now = Date.parse("2026-10-30T12:00:00Z");
const ago = (d: number) => new Date(now - d * 86_400_000).toISOString();

describe("buildWeeklyRecap", () => {
  it("is empty with no activity", () => {
    expect(buildWeeklyRecap(buildWeeklyLoop({ debates: [], repairs: [], retests: [] }, now)).state).toBe("empty");
  });
  it("withholds outcome claims below the sample gate", () => {
    const r = buildWeeklyRecap(buildWeeklyLoop({
      debates: [{ completedAt: ago(1) }, { completedAt: ago(2) }, { completedAt: ago(9) }],
      repairs: [{ createdAt: ago(1), succeeded: true }],
      retests: [{ completedAt: ago(1), observable: true, demonstrated: true }],
    }, now));
    expect(r.state).toBe("counts_only");
    expect(r.lines.join(" ")).toContain("1 debate more than");
    expect(r.lines.join(" ")).toContain("Not enough measured retests");
    expect(r.lines.join(" ")).not.toContain("%");
  });
  it("shows a labelled rate once gated", () => {
    const retests = Array.from({ length: 5 }, (_, i) => ({ completedAt: ago(i + 1), observable: true, demonstrated: i < 3 }));
    const r = buildWeeklyRecap(buildWeeklyLoop({ debates: [{ completedAt: ago(1) }], repairs: [], retests }, now));
    expect(r.state).toBe("ok");
    expect(r.lines.join(" ")).toContain("60%");
    expect(r.lines.join(" ")).toContain("Unvalidated");
  });
});

import { summariseRecapViews } from "./weeklyRecap";
describe("summariseRecapViews", () => {
  it("hides counts under 5 distinct viewers", () => {
    const rows = Array.from({ length: 20 }, () => ({ userId: "a" }));
    expect(summariseRecapViews(rows)).toEqual({ status: "insufficient_evidence", viewers: 1, needed: 5 });
  });
  it("shows counts at 5 viewers", () => {
    const rows = ["a", "b", "c", "d", "e", "a"].map((userId) => ({ userId }));
    expect(summariseRecapViews(rows)).toEqual({ status: "ok", viewers: 5, views: 6 });
  });
});
