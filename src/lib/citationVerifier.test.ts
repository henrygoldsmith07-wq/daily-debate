import { describe, expect, it } from "vitest";
import {
  citationIdentityCheck,
  isRootHomepage,
  verifyCitation,
} from "./citationVerifier";

describe("citation source identity", () => {
  it("accepts a registered source on its registered root domain", () => {
    const check = citationIdentityCheck({
      sourceName: "NREL",
      homepage: "https://www.nrel.gov",
    });

    expect(check.verified).toBe(true);
    expect(check.expectedHomepage).toBe("https://www.nrel.gov");
    expect(verifyCitation({ sourceName: "NREL", homepage: "https://www.nrel.gov" })).toEqual([]);
  });

  it("rejects a known source name attached to another domain", () => {
    const citation = { sourceName: "NREL", homepage: "https://example.com" };
    const check = citationIdentityCheck(citation);

    expect(check.verified).toBe(false);
    expect(check.reason).toMatch(/does not match/i);
    expect(verifyCitation(citation)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "bad_url", message: expect.stringMatching(/nrel\.gov/i) }),
      ]),
    );
  });

  it("keeps aliases valid when they resolve to the same registered domain", () => {
    expect(
      citationIdentityCheck({
        sourceName: "Pew",
        homepage: "https://pewresearch.org",
      }).verified,
    ).toBe(true);
  });

  it("does not verify unknown or incomplete identities", () => {
    expect(citationIdentityCheck({ sourceName: "Made Up Institute", homepage: "https://example.com" }).verified).toBe(false);
    expect(citationIdentityCheck({ sourceName: "NREL" }).verified).toBe(false);
  });
});

describe("root homepage validation", () => {
  it("accepts only the origin root", () => {
    expect(isRootHomepage("https://www.nrel.gov")).toBe(true);
    expect(isRootHomepage("https://www.nrel.gov/")).toBe(true);
    expect(isRootHomepage("https://www.nrel.gov/research")).toBe(false);
    expect(isRootHomepage("https://www.nrel.gov/?article=1")).toBe(false);
    expect(isRootHomepage("https://www.nrel.gov/#about")).toBe(false);
  });
});
