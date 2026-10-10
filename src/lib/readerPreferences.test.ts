import { describe, expect, it } from "vitest";
import { READER_PREFERENCE_OPTIONS } from "./readerPreferences";

// The hook itself is DOM-bound; what is unit-testable here is the option
// contract, which is what the UI renders and what the inline layout script must
// stay in sync with.

describe("reader preferences", () => {
  it("offers the four preferences the stylesheet implements", () => {
    expect(READER_PREFERENCE_OPTIONS.map((o) => o.key).sort()).toEqual([
      "dyslexia",
      "high-contrast",
      "large-text",
      "reduce-motion",
    ]);
  });

  it("has unique keys", () => {
    const keys = READER_PREFERENCE_OPTIONS.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("describes every option in learner-facing language", () => {
    for (const option of READER_PREFERENCE_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
      // A description that says nothing is worse than none: the whole point is
      // telling the reader what the toggle will do.
      expect(option.description.trim().length).toBeGreaterThan(10);
    }
  });

  it("uses only keys that are valid CSS class names on <html>", () => {
    for (const option of READER_PREFERENCE_OPTIONS) {
      expect(option.key).toMatch(/^[a-z][a-z-]*$/);
    }
  });
});
