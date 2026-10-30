import { describe, expect, it } from "vitest";
import { continueKicker, isRetestHero } from "./retestHero";

describe("retest hero", () => {
  it("leads with 'Your retest is ready' only for a retest", () => {
    expect(continueKicker("retest")).toBe("Your retest is ready");
    expect(continueKicker("drill")).toBe("Continue training");
    expect(isRetestHero("retest")).toBe(true);
    expect(isRetestHero("drill")).toBe(false);
  });
});
