import { describe, expect, it } from "vitest";
import { generateChallengeCode, isValidChallengeCode } from "./friendChallenge";

describe("friend challenge codes", () => {
  it("generates a 12-character code from the unambiguous alphabet", () => {
    let next = 0;
    const code = generateChallengeCode((max) => (next++ % max));
    expect(code).toHaveLength(12);
    expect(isValidChallengeCode(code)).toBe(true);
  });

  it.each(["", "abc01xyz", "with/slash", "123456", "A2345678"])(
    "rejects invalid code %s",
    (code) => expect(isValidChallengeCode(code)).toBe(false),
  );
});
