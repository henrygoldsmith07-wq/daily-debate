import { describe, expect, it } from "vitest";
import { CLIENT_PRODUCT_EVENT_NAMES, isClientProductEventName } from "./clientProductEvents";

describe("client product event boundary", () => {
  it("allows only events the browser owns", () => {
    for (const name of CLIENT_PRODUCT_EVENT_NAMES) expect(isClientProductEventName(name)).toBe(true);
  });

  it.each([
    "debate_completed",
    "retest_skill_demonstrated",
    "challenge_link_accepted",
    "challenge_link_created",
    "every_keystroke",
  ])("rejects server-owned or unknown event %s", (name) => {
    expect(isClientProductEventName(name)).toBe(false);
  });
});
