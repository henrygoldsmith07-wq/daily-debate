import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WeaknessLibraryPanel from "./WeaknessLibraryPanel";
import type { ChainEntry } from "@/lib/loopChain";

const e = (id: string, kind: ChainEntry["targetKind"], stage: ChainEntry["stage"], at: string): ChainEntry => ({
  repairId: id, targetKind: kind, repairedAt: at, stage, retestAssignments: 1, completedAt: null, recurrence: "insufficient_evidence",
});

describe("WeaknessLibraryPanel", () => {
  it("renders nothing without repairs", () => {
    expect(renderToStaticMarkup(<WeaknessLibraryPanel chain={[]} />)).toBe("");
  });
  it("groups by skill, offers re-drill only when not demonstrated, never claims a rate", () => {
    const html = renderToStaticMarkup(
      <WeaknessLibraryPanel chain={[
        e("1", "evidence", "retest_not_demonstrated", "2026-10-20T00:00:00Z"),
        e("2", "evidence", "retest_demonstrated", "2026-10-10T00:00:00Z"),
        e("3", "logic", "retest_demonstrated", "2026-10-15T00:00:00Z"),
      ]} />,
    );
    expect(html.match(/data-testid="weakness-group"/g)).toHaveLength(2);
    expect(html).toContain("2 repairs");
    expect(html).toContain('data-kind="evidence" data-redrill="yes"');
    expect(html).toContain('data-kind="logic" data-redrill="no"');
    expect(html).not.toContain("%");
  });
});
