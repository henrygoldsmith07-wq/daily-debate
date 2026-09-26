import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./authRedirect";

describe("safeReturnPath", () => {
  it.each([
    ["/challenge/abc234", "/challenge/abc234"],
    ["/progress?view=skills", "/progress?view=skills"],
    ["/pvp/123#turn", "/pvp/123#turn"],
  ])("keeps internal path %s", (value, expected) => {
    expect(safeReturnPath(value)).toBe(expected);
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
    "javascript:alert(1)",
    "/login?next=/history",
  ])("rejects unsafe return target %s", (value) => {
    expect(safeReturnPath(value)).toBe("/");
  });
});
