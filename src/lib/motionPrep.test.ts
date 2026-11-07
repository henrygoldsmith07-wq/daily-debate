import { describe, expect, it } from "vitest";
import { parseMotionPrep } from "./motionPrep";

const side = { strongest: "Cars dominate street space.", ifTheySay: "Deliveries need cars.", reply: "Exempt deliveries, not commuters." };

describe("parseMotionPrep", () => {
  it("accepts a complete prep and normalises whitespace", () => {
    expect(parseMotionPrep({ for: { ...side, strongest: "  Cars   dominate\nstreet space. " }, against: side })).toEqual({
      for: side,
      against: side,
    });
  });

  it("refuses a missing side, a missing field, or text out of bounds", () => {
    expect(parseMotionPrep({ for: side })).toBeNull();
    expect(parseMotionPrep({ for: side, against: { ...side, reply: undefined } })).toBeNull();
    expect(parseMotionPrep({ for: side, against: { ...side, reply: "no" } })).toBeNull();
    expect(parseMotionPrep({ for: side, against: { ...side, reply: "x".repeat(401) } })).toBeNull();
    expect(parseMotionPrep(null)).toBeNull();
  });
});
