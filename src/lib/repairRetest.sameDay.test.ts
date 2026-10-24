import { describe, expect, it } from "vitest";
import { planRetestMotion, selectEligiblePendingRetest, type RepairRetestAnchor } from "./repairRetest";

// Product decision (Henry, 24 Oct 2026): a repair made today may be retested
// TODAY when the motion is a different topic (day-1 retargeting is the
// roadmap's lever); a same-day replay of the repaired topic stays excluded.

const TODAY = "2026-10-24";

describe("same-day retest rules", () => {
  it("serves a same-day retest on a different shared topic", () => {
    expect(
      planRetestMotion({ repairTopicId: "topic-a", repairedOn: TODAY, sharedTopicId: "topic-b", today: TODAY }),
    ).toBe("serve-shared");
  });

  it("never retests the repaired topic on the repair day (no swap, stays queued)", () => {
    expect(
      planRetestMotion({ repairTopicId: "topic-a", repairedOn: TODAY, sharedTopicId: "topic-a", today: TODAY }),
    ).toBe("keep-queued");
  });

  it("swaps the motion when the repaired topic comes round again on a later day", () => {
    expect(
      planRetestMotion({ repairTopicId: "topic-a", repairedOn: "2026-10-23", sharedTopicId: "topic-a", today: TODAY }),
    ).toBe("swap-motion");
  });

  it("keeps an unverifiable repaired topic queued", () => {
    expect(
      planRetestMotion({ repairTopicId: null, repairedOn: "2026-10-23", sharedTopicId: "topic-a", today: TODAY }),
    ).toBe("keep-queued");
  });

  it("start-route selection: a same-day repair is eligible on a different topic, not on the same one", () => {
    const repairedToday: RepairRetestAnchor = {
      repairResultId: "r-today",
      debateId: "d-today",
      targetKind: "evidence",
      attemptedAt: `${TODAY}T09:00:00.000Z`,
      topicId: "topic-a",
    };
    expect(selectEligiblePendingRetest([], [repairedToday], "topic-b")?.repairResultId).toBe("r-today");
    expect(selectEligiblePendingRetest([], [repairedToday], "topic-a")).toBeNull();
  });
});
