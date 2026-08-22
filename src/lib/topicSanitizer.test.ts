import { describe, it, expect } from "vitest";
import { sanitizeGeneratedTopic, normaliseHomepage } from "./topicSanitizer";

describe("normaliseHomepage", () => {
  it("reduces deep links to the https origin", () => {
    expect(normaliseHomepage("https://www.pewresearch.org/topic/energy/?utm=x")).toBe("https://www.pewresearch.org");
  });

  it("upgrades http and adds missing scheme", () => {
    expect(normaliseHomepage("http://lazard.com")).toBe("https://lazard.com");
    expect(normaliseHomepage("www.nrel.gov")).toBe("https://www.nrel.gov");
  });

  it("rejects non-web and unparseable values", () => {
    expect(normaliseHomepage("javascript:alert(1)")).toBeNull();
    expect(normaliseHomepage("ftp://files.example.com")).toBeNull();
    expect(normaliseHomepage("not a url")).toBeNull();
    expect(normaliseHomepage(42)).toBeNull();
    expect(normaliseHomepage(undefined)).toBeNull();
  });
});

describe("sanitizeGeneratedTopic", () => {
  const good = { name: "Pew Research Center", homepage: "https://www.pewresearch.org/stuff", angle: "Polling" };

  it("keeps valid sources and strips paths to the root", () => {
    const out = sanitizeGeneratedTopic({ title: "T", prompt: "P", category: "Tech", sources: [good] });
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0].homepage).toBe("https://www.pewresearch.org");
  });

  it("drops invalid/duplicate sources and caps at five", () => {
    const dup = { name: "pew research center", homepage: "https://pewresearch.org", angle: "dup" };
    const junk = [
      good,
      dup,
      { name: "", homepage: "https://x.io", angle: "no name" },
      { name: "No Homepage", angle: "bad" },
      ...Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, homepage: `https://s${i}.example`, angle: "a" })),
    ];
    const out = sanitizeGeneratedTopic({ title: "T", prompt: "P", category: "C", sources: junk as never });
    expect(out.sources.map((s) => s.name)).toEqual(["Pew Research Center", "S0", "S1", "S2", "S3"]);
  });

  it("substitutes sane fallbacks for garbage text fields", () => {
    const out = sanitizeGeneratedTopic({ title: "   ", prompt: undefined as never, category: "", sources: [] });
    expect(out.title.length).toBeGreaterThan(0);
    expect(out.prompt.length).toBeGreaterThan(0);
    expect(out.category).toBe("General");
  });

  it("survives null/undefined input without throwing", () => {
    expect(() => sanitizeGeneratedTopic(null)).not.toThrow();
    expect(() => sanitizeGeneratedTopic(undefined)).not.toThrow();
    expect(sanitizeGeneratedTopic(undefined).sources).toEqual([]);
  });
});
