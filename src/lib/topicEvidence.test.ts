import { describe, it, expect } from "vitest";
import { keywordsFrom, pickPassage, sourceTypeFor, assembleCard } from "./topicEvidence";
import { stubRetrievedSource } from "./sourceRetrieval";

describe("keywordsFrom", () => {
  it("drops stopwords and short tokens, ranks by frequency", () => {
    const kw = keywordsFrom("Solar energy costs and solar storage: the costs of solar panels keep falling.");
    expect(kw[0]).toBe("solar");
    expect(kw).not.toContain("the");
    expect(kw).not.toContain("and");
    expect(kw).toContain("energy");
  });
});

describe("pickPassage", () => {
  it("returns the whole text when short", () => {
    expect(pickPassage("Short passage already.", ["short"])).toBe("Short passage already.");
  });

  it("selects the keyword-densest window of a long document", () => {
    const filler = Array.from({ length: 120 }, (_, i) => `fillerword${i}`).join(" ");
    const dense = "Lazard LCOE analysis shows solar costs fell again. NREL storage confirms the trend.";
    const text = `${filler} ${dense} ${Array.from({ length: 60 }, (_, i) => `tail${i}`).join(" ")}`;
    const picked = pickPassage(text, ["lazard", "lcoe", "solar", "nrel"]);
    expect(picked).toContain("Lazard");
  });
});

describe("sourceTypeFor", () => {
  it("classifies wikipedia as tertiary and wires as news", () => {
    expect(sourceTypeFor("https://en.wikipedia.org/wiki/Energy", "Wikipedia")).toBe("tertiary");
    expect(sourceTypeFor("https://www.reuters.com/x", "Reuters")).toBe("news");
  });

  it("uses the allowlist for primary classification", () => {
    expect(sourceTypeFor("https://www.lazard.com/research", "Lazard")).toBe("primary");
    expect(sourceTypeFor("https://example.com/a", "example.com")).toBe("secondary");
  });
});

describe("assembleCard verification checks", () => {
  const topic = { title: "Renewables cost", prompt: "Have renewables become cheaper than fossil fuels?" };

  it("flags a current primary source that supports the claim", () => {
    const src = stubRetrievedSource({
      url: "https://www.lazard.com/research/lcoe",
      title: "Levelized Cost of Energy Analysis",
      publisher: "Lazard",
      publicationDate: new Date().getFullYear() + "-06-01",
      excerpt:
        "Renewables have become cheaper than fossil fuels: the Lazard analysis shows utility-scale solar's levelized cost of energy is now below coal and gas in most regions.",
      retrievalDate: new Date().toISOString(),
    });
    const card = assembleCard(topic, src);
    expect(card).not.toBeNull();
    expect(card!.checks.primary).toBe(true);
    expect(card!.checks.current).toBe(true);
    expect(card!.checks.relevant).toBe(true);
  });

  it("marks stale sources as not-current and unknown publishers as secondary", () => {
    const src = stubRetrievedSource({
      url: "https://myblog.example/old-post",
      title: "Old post",
      publisher: "MyBlog",
      publicationDate: "2018-01-01",
      excerpt:
        "Energy markets changed a lot over the past decade in many different regions worldwide, and the pace of that change has surprised analysts and utilities alike across several continents.",
      retrievalDate: new Date().toISOString(),
    });
    const card = assembleCard(topic, src);
    expect(card!.checks.current).toBe(false);
    expect(card!.checks.primary).toBe(false);
    expect(card!.sourceType).toBe("secondary");
  });

  it("rejects sources with too little retrieved content", () => {
    const src = stubRetrievedSource({ url: "https://x.example/", publisher: "X", excerpt: "tiny" });
    expect(assembleCard(topic, src)).toBeNull();
  });
});
