import { describe, expect, it } from "vitest";
import { isProductEventName, isProductEventReason } from "./productEvents";

describe("product event privacy allowlists", () => {
  it("accepts only registered product event names", () => {
    expect(isProductEventName("repair_started")).toBe(true);
    expect(isProductEventName("every_keystroke")).toBe(false);
  });

  it.each([
    "side-balance",
    "needs_another_pass",
    "repair_demonstrated",
    "evidence",
    "clarity",
  ])("accepts categorical reason %s", (reason) => {
    expect(isProductEventReason(reason)).toBe(true);
  });

  it.each([
    "You have argued FOR in 7 of your last 8 debates",
    "user supplied free text",
    "retry because I felt like it",
  ])("rejects free-text reason %s", (reason) => {
    expect(isProductEventReason(reason)).toBe(false);
  });
});
