import { describe, expect, it } from "vitest";
import { shapePastMotions, type PastMotionRow } from "./pastMotions";

const row = (topic_date: string, over: Partial<PastMotionRow> = {}): PastMotionRow => ({
  id: `t-${topic_date}`,
  topic_date,
  title: `Motion ${topic_date}`,
  category: null,
  debated: false,
  active_id: null,
  ...over,
});

describe("shapePastMotions", () => {
  it("keeps days before today inside the window, newest first", () => {
    const out = shapePastMotions(
      [row("2026-11-05"), row("2026-11-07"), row("2026-11-06", { debated: true }), row("2026-10-07"), row("2026-10-08"), row("1999-12-29")],
      "2026-11-07",
    );
    expect(out.map((m) => m.day)).toEqual(["2026-11-06", "2026-11-05", "2026-10-08"]);
    expect(out[0]).toMatchObject({ debated: true, activeDebateId: null });
  });

  it("drops malformed dates and duplicate days", () => {
    const out = shapePastMotions([row("nope"), row("2026-11-06"), row("2026-11-06", { id: "dup" })], "2026-11-07");
    expect(out.map((m) => m.id)).toEqual(["t-2026-11-06"]);
  });

  it("passes an unfinished debate through so it can be continued", () => {
    expect(shapePastMotions([row("2026-11-06", { active_id: "d1" })], "2026-11-07")[0].activeDebateId).toBe("d1");
  });

  it("returns nothing for a malformed today", () => {
    expect(shapePastMotions([row("2026-11-06")], "bad")).toEqual([]);
  });
});
