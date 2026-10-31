// Spoiler-free result sharing, copied from Wordle's emoji grid.
//
// A share carries the day's number, the side, one square per round and
// whether the repair was done — never a word the learner wrote, never a
// score. The squares are observed moves from the same deterministic checks
// the result screen uses, labelled as such on the landing page.

import type { ArgGraph, Owner } from "./argGraph";
import { engagementAnsweredIds, engagementOpportunitiesFor } from "./opportunity";

/** answered = met the opponent's move · partial = argued without answering it · dropped = left it unanswered · none = nothing to answer. */
export type RoundMark = "answered" | "partial" | "dropped" | "none";

const SQUARE: Record<RoundMark, string> = { answered: "🟩", partial: "🟨", dropped: "🟥", none: "⬜" };
const CODE: Record<RoundMark, string> = { answered: "a", partial: "p", dropped: "d", none: "n" };
const FROM_CODE: Record<string, RoundMark> = { a: "answered", p: "partial", d: "dropped", n: "none" };

/** GuestMotion id of a live guest sprint on today's shared motion (guestLive.ts). */
export const LIVE_GUEST_MOTION_ID = "live-today";

/** Day #1 is the repository's first day; the number only ever counts up. */
export const SHARE_EPOCH = "2026-08-21";
export const MAX_SHARE_ROUNDS = 12;

const DAY_MS = 86_400_000;

export function dailyNumber(dateIso: string): number {
  const day = Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`);
  const epoch = Date.parse(`${SHARE_EPOCH}T00:00:00Z`);
  if (!Number.isFinite(day)) return 1;
  return Math.max(1, Math.floor((day - epoch) / DAY_MS) + 1);
}

export function squares(marks: readonly RoundMark[]): string {
  return marks.map((mark) => SQUARE[mark]).join("");
}

/**
 * One mark per opponent move the learner could have answered, in round order
 * (the engagement definition every other layer uses). A debate whose graph has
 * no such move yields no marks rather than invented ones.
 */
export function soloRoundMarks(graph: ArgGraph | null, owner: Owner = "a"): RoundMark[] {
  if (!graph) return [];
  const opportunities = engagementOpportunitiesFor(graph, owner);
  const answered = engagementAnsweredIds(graph, owner);
  const rounds = [...new Set(opportunities.map((node) => node.round))].sort((a, b) => a - b);
  return rounds
    .slice(0, MAX_SHARE_ROUNDS)
    .map((round) =>
      opportunities.some((node) => node.round === round && answered.has(node.id)) ? "answered" : "dropped",
    );
}

/** Guest rounds, from the guest check's own observations. */
export function guestRoundMark(observed: { opponent: boolean; claim: boolean; reasoning: boolean }): RoundMark {
  if (observed.opponent) return "answered";
  if (observed.claim && observed.reasoning) return "partial";
  return "dropped";
}

export interface ShareCardInput {
  /** Omit for practice on a sample motion, which is not "the" daily debate. */
  dayNumber?: number;
  side: "for" | "against";
  marks: readonly RoundMark[];
  repaired: boolean;
}

/** The share sheet text; the link travels separately (share sheets add it themselves). */
export function shareText(input: ShareCardInput, url?: string): string {
  const heading = input.dayNumber ? `Daily Debate #${input.dayNumber}` : "Daily Debate practice";
  const side = input.side === "for" ? "For" : "Against";
  const lines = [`${heading} · ${side}`];
  if (input.marks.length) lines.push(squares(input.marks));
  lines.push(input.repaired ? "Weakness repaired ✓" : "Repair still to do");
  if (url) lines.push(url);
  return lines.join("\n");
}

/** Query string for the share landing page and its image: codes only, no free text. */
export function shareQuery(input: ShareCardInput): string {
  const params = new URLSearchParams();
  if (input.dayNumber) params.set("n", String(input.dayNumber));
  params.set("s", input.side === "for" ? "f" : "a");
  params.set("g", input.marks.slice(0, MAX_SHARE_ROUNDS).map((mark) => CODE[mark]).join(""));
  params.set("r", input.repaired ? "1" : "0");
  return params.toString();
}

/** Parse share params from an untrusted URL. Anything malformed is dropped, never echoed. */
export function parseShareQuery(params: Record<string, string | string[] | undefined>): ShareCardInput | null {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const side = one("s");
  if (side !== "f" && side !== "a") return null;
  const grid = one("g") ?? "";
  if (grid.length > MAX_SHARE_ROUNDS || !/^[apdn]*$/.test(grid)) return null;
  const rawNumber = one("n");
  const dayNumber = rawNumber !== undefined && /^\d{1,5}$/.test(rawNumber) ? Number(rawNumber) : undefined;
  return {
    ...(dayNumber && dayNumber > 0 ? { dayNumber } : {}),
    side: side === "f" ? "for" : "against",
    marks: [...grid].map((code) => FROM_CODE[code]),
    repaired: one("r") === "1",
  };
}

export const MARK_LEGEND: readonly { mark: RoundMark; label: string }[] = [
  { mark: "answered", label: "answered the opponent's move" },
  { mark: "partial", label: "made a reasoned point without answering it" },
  { mark: "dropped", label: "left the opponent's move unanswered" },
];

/** Relative URL of the share landing page for a card. */
export function sharePath(input: ShareCardInput): string {
  return `/s?${shareQuery(input)}`;
}

export function squareFor(mark: RoundMark): string {
  return SQUARE[mark];
}
