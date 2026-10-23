import { describe, expect, it } from "vitest";
import { clearDraft, DRAFT_MAX_AGE_MS, loadDraft, saveDraft } from "./composerDraft";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
}

describe("composerDraft", () => {
  it("round-trips a draft per key", () => {
    const s = memory();
    saveDraft("a", "my point", 1000, s);
    saveDraft("b", "other", 1000, s);
    expect(loadDraft("a", 2000, s)).toBe("my point");
    expect(loadDraft("b", 2000, s)).toBe("other");
  });
  it("drops expired drafts", () => {
    const s = memory();
    saveDraft("a", "x", 1000, s);
    expect(loadDraft("a", 1000 + DRAFT_MAX_AGE_MS + 1, s)).toBe("");
    expect(s.size()).toBe(0);
  });
  it("removes the entry when text is blank or cleared", () => {
    const s = memory();
    saveDraft("a", "x", 1, s);
    saveDraft("a", "   ", 2, s);
    expect(s.size()).toBe(0);
    saveDraft("a", "y", 3, s);
    clearDraft("a", s);
    expect(loadDraft("a", 4, s)).toBe("");
  });
  it("ignores corrupt entries and missing storage", () => {
    const s = memory();
    s.setItem("dd:composer-draft:a", "{nope");
    expect(loadDraft("a", 1, s)).toBe("");
    s.setItem("dd:composer-draft:a", JSON.stringify({ text: 5, savedAt: 1 }));
    expect(loadDraft("a", 1, s)).toBe("");
    expect(loadDraft("a", 1, null)).toBe("");
    expect(() => saveDraft("a", "x", 1, null)).not.toThrow();
  });
});
