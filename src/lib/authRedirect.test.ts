import { describe, expect, it } from "vitest";
import { authModeFromParam, safeReturnPath, SIGN_UP_PATH } from "./authRedirect";

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

describe("sign-up entry point", () => {
  it("links sign-up CTAs to the Create account tab", () => {
    expect(SIGN_UP_PATH).toBe("/login?mode=signup");
    expect(authModeFromParam("signup")).toBe("sign-up");
  });

  it("opens sign-in for anything else", () => {
    for (const value of [undefined, null, "", "login", "SIGNUP", 1, ["login"]]) {
      expect(authModeFromParam(value)).toBe("sign-in");
    }
    expect(authModeFromParam(["signup", "login"])).toBe("sign-up");
  });
});
