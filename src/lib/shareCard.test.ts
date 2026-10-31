import { describe, expect, it } from "vitest";
import type { ArgGraph, ArgNode } from "./argGraph";
import {
  dailyNumber,
  guestRoundMark,
  MAX_SHARE_ROUNDS,
  parseShareQuery,
  shareQuery,
  shareText,
  soloRoundMarks,
  squares,
  type ShareCardInput,
} from "./shareCard";

function graphOf(nodes: ArgNode[]): ArgGraph {
  return {
    nodes,
    edges: [],
    dropped: [],
    contradictions: [],
    concessions: [],
    fallacies: [],
    evidenceStats: { total: 0, byOwner: { a: 0, b: 0, ai: 0 }, byStrength: { cited: 0, strong: 0, general: 0, anecdotal: 0 }, unsupportedClaimIds: [] },
    impactComparison: null,
  };
}

const node = (id: string, kind: ArgNode["kind"], owner: "a" | "ai", round: number, targets?: string[]): ArgNode => ({
  id,
  kind,
  owner,
  round,
  text: "t",
  ...(targets ? { targets } : {}),
});

describe("dailyNumber", () => {
  it("counts days from the epoch, starting at 1", () => {
    expect(dailyNumber("2026-08-21")).toBe(1);
    expect(dailyNumber("2026-08-22")).toBe(2);
    expect(dailyNumber("2026-10-30T23:59:00Z")).toBe(71);
    expect(dailyNumber("2020-01-01")).toBe(1);
    expect(dailyNumber("junk")).toBe(1);
  });
});

describe("soloRoundMarks", () => {
  it("marks each opponent round answered or dropped, in round order", () => {
    const graph = graphOf([
      node("o1", "claim", "ai", 1),
      node("u1", "rebuttal", "a", 2, ["o1"]),
      node("o2", "claim", "ai", 2),
      node("u2", "claim", "a", 3),
      node("o3", "claim", "ai", 3),
      node("u3", "rebuttal", "a", 4, ["o3"]),
    ]);
    expect(soloRoundMarks(graph)).toEqual(["answered", "dropped", "answered"]);
  });

  it("invents nothing when there is no graph or no opportunity", () => {
    expect(soloRoundMarks(null)).toEqual([]);
    expect(soloRoundMarks(graphOf([node("u1", "claim", "a", 1)]))).toEqual([]);
  });
});

describe("guestRoundMark", () => {
  it("is answered only when the opponent was addressed", () => {
    expect(guestRoundMark({ opponent: true, claim: false, reasoning: false })).toBe("answered");
    expect(guestRoundMark({ opponent: false, claim: true, reasoning: true })).toBe("partial");
    expect(guestRoundMark({ opponent: false, claim: true, reasoning: false })).toBe("dropped");
  });
});

describe("shareText", () => {
  const input: ShareCardInput = { dayNumber: 71, side: "against", marks: ["answered", "partial", "dropped"], repaired: true };

  it("reads like a Wordle share: number, side, squares, repair, link", () => {
    expect(shareText(input, "https://x.test/s?n=71")).toBe(
      "Daily Debate #71 · Against\n🟩🟨🟥\nWeakness repaired ✓\nhttps://x.test/s?n=71",
    );
  });

  it("calls a sample-motion run practice, not a numbered daily", () => {
    expect(shareText({ ...input, dayNumber: undefined, repaired: false }, "u")).toBe("Daily Debate practice · Against\n🟩🟨🟥\nRepair still to do\nu");
  });

  it("never contains anything but the fixed vocabulary", () => {
    const text = shareText(input, "URL");
    expect(text.replace(/Daily Debate #71 · Against|Weakness repaired ✓|URL|[🟩🟨🟥⬜\n]/gu, "")).toBe("");
  });
});

describe("shareQuery / parseShareQuery", () => {
  it("round-trips", () => {
    const input: ShareCardInput = { dayNumber: 71, side: "for", marks: ["answered", "none", "dropped"], repaired: false };
    expect(parseShareQuery(Object.fromEntries(new URLSearchParams(shareQuery(input))))).toEqual(input);
    expect(squares(input.marks)).toBe("🟩⬜🟥");
  });

  it("drops anything malformed instead of echoing it", () => {
    expect(parseShareQuery({ s: "x", g: "a" })).toBeNull();
    expect(parseShareQuery({ s: "f", g: "<script>" })).toBeNull();
    expect(parseShareQuery({ s: "f", g: "a".repeat(MAX_SHARE_ROUNDS + 1) })).toBeNull();
    expect(parseShareQuery({ s: "a", g: "ap", n: "-3" })).toEqual({ side: "against", marks: ["answered", "partial"], repaired: false });
    expect(parseShareQuery({ s: "a", g: "", n: "123456" })?.dayNumber).toBeUndefined();
  });
});
