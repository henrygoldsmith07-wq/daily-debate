// Live guest sprint: a signed-out learner debates today's shared motion
// against the real AI opponent, with no account.
//
// This module is the pure, shared half (client + server): the request shape
// the guest route accepts, its validation, and the motion object the existing
// guest result / repair / retest screens consume. Assessment stays local and
// deterministic (guestAssessment.ts); only the opponent's replies come from a
// model. Nothing a guest writes is stored server-side.

import type { GuestMotion, GuestMotionRound } from "./guestMotions";
import { DEFAULT_PERSONA, resolvePersona, type OpponentPersonaId } from "./opponentPersona";

/** A sprint is three answered rounds. */
export const GUEST_LIVE_ROUNDS = 3;
/** Per-message bound on what the guest route accepts (user or opponent text). */
export const GUEST_LIVE_MAX_TEXT = 2000;
/** Same floor the guest composer enforces before Send is enabled. */
export const GUEST_LIVE_MIN_RESPONSE = 12;

/** Opponent calls per IP per 24h: an opening plus three replies is one sprint, so this is two. */
export const GUEST_LIVE_IP_CALLS_PER_DAY = 8;

/** Per-IP allowance; GUEST_AI_IP_CALLS overrides it (the e2e suite shares one IP). */
export function guestLiveIpCallCap(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.GUEST_AI_IP_CALLS);
  return Number.isInteger(raw) && raw >= 0 ? raw : GUEST_LIVE_IP_CALLS_PER_DAY;
}
/** Global guest opponent calls per 24h when GUEST_AI_DAILY_CALLS is unset. */
export const GUEST_LIVE_DEFAULT_DAILY_CALLS = 400;

export function guestLiveDailyCallCap(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.GUEST_AI_DAILY_CALLS);
  return Number.isInteger(raw) && raw >= 0 ? raw : GUEST_LIVE_DEFAULT_DAILY_CALLS;
}

export interface GuestLiveHistoryEntry {
  role: "ai" | "user";
  text: string;
}

export interface GuestLiveMotion {
  title: string;
  prompt: string;
  category: string | null;
}

/**
 * Round frames for a live sprint. Labels and prompts are motion-independent
 * because the opposing case is generated, not scripted.
 */
export const GUEST_LIVE_FRAMES: readonly Pick<GuestMotionRound, "label" | "prompt">[] = [
  { label: "Make your case", prompt: "Answer the opening with one clear claim and the reason it holds." },
  { label: "Take the pressure", prompt: "Answer the opponent's strongest point before adding a new one." },
  { label: "Close with impact", prompt: "Compare what matters most on each side and land your verdict." },
];

export const GUEST_LIVE_RETEST_FRAME: Pick<GuestMotionRound, "label" | "prompt"> = {
  label: "A new challenge",
  prompt: "Meet this new objection on its own terms, and show the reasoning that carries your case through it.",
};

/**
 * Motion-independent challenges used when the opponent cannot answer
 * mid-sprint and the learner chooses to carry on. Index = round index.
 * Round 0 has none: a failed opening falls back to the whole guided case.
 */
export const GUEST_LIVE_FALLBACK_OPPONENT: readonly (string | null)[] = [
  null,
  "Your case leans on one reason. Someone who disagrees will say that reason does not hold in the cases that matter most. Why should they accept it?",
  "Even if your point stands, the other side has costs you have not weighed. Why do the benefits you describe outweigh them?",
];

export const GUEST_LIVE_FALLBACK_RETEST =
  "Suppose your strongest reason is true. A careful opponent would still ask what happens to the people your position leaves worse off. Answer that without dropping your case.";

/**
 * Extra directive for the reply to the final round: it becomes the retest
 * challenge, which must be a NEW objection rather than a closing speech, so
 * the retest observes transfer instead of recall.
 */
export const GUEST_LIVE_RETEST_DIRECTIVE =
  "This reply will be shown later as a fresh challenge. Raise ONE new objection the user has not yet answered in this debate, in 2-3 sentences. Do not summarise or close the debate.";

export type GuestHistoryValidation =
  | { ok: true; history: GuestLiveHistoryEntry[]; userTurns: number }
  | { ok: false; error: string };

/**
 * Validate the transcript a guest client sends. The route is stateless, so the
 * client carries the transcript; this bounds it to the one shape a sprint can
 * produce: empty (opening), or opponent/user alternating from the opponent,
 * ending on a user turn, at most three user turns.
 */
export function validateGuestHistory(raw: unknown): GuestHistoryValidation {
  if (raw === undefined || raw === null) return { ok: true, history: [], userTurns: 0 };
  if (!Array.isArray(raw)) return { ok: false, error: "history must be an array" };
  if (raw.length > GUEST_LIVE_ROUNDS * 2) return { ok: false, error: "history is too long" };
  const history: GuestLiveHistoryEntry[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "malformed history entry" };
    const { role, text } = entry as Record<string, unknown>;
    const expected = index % 2 === 0 ? "ai" : "user";
    if (role !== expected) return { ok: false, error: "history must alternate opponent and user turns" };
    if (typeof text !== "string") return { ok: false, error: "malformed history entry" };
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > GUEST_LIVE_MAX_TEXT) return { ok: false, error: "history entry length out of bounds" };
    if (role === "user" && trimmed.length < GUEST_LIVE_MIN_RESPONSE) {
      return { ok: false, error: "response is too short" };
    }
    history.push({ role: expected, text: trimmed });
  }
  if (history.length > 0 && history[history.length - 1].role !== "user") {
    return { ok: false, error: "history must end with a user turn" };
  }
  return { ok: true, history, userTurns: history.filter((entry) => entry.role === "user").length };
}

/** Interleave opponent turns and responses into the transcript the route expects. */
export function guestLiveHistory(opponents: readonly string[], responses: readonly string[], throughRound: number): GuestLiveHistoryEntry[] {
  const history: GuestLiveHistoryEntry[] = [];
  for (let round = 0; round <= throughRound; round++) {
    const ai = opponents[round];
    const user = responses[round];
    if (typeof ai !== "string" || typeof user !== "string") break;
    history.push({ role: "ai", text: ai }, { role: "user", text: user });
  }
  return history;
}

export interface GuestLiveState {
  motion: GuestLiveMotion;
  persona: OpponentPersonaId;
  /** Opponent text per round; a missing index is still being generated. */
  opponents: string[];
  /** The fresh challenge for the retest, once generated. */
  retest: string | null;
}

export function emptyGuestLiveState(motion: GuestLiveMotion, persona: OpponentPersonaId = DEFAULT_PERSONA): GuestLiveState {
  return { motion, persona: resolvePersona(persona), opponents: [], retest: null };
}

/**
 * The GuestMotion the shared guest screens consume. Rounds whose opponent text
 * has not arrived carry an empty string; the result/retest screens are only
 * reached once all three exist.
 */
export function buildLiveGuestMotion(state: GuestLiveState): GuestMotion {
  return {
    id: "live-today",
    motion: state.motion.title,
    topic: state.motion.category?.trim() || "Today",
    coachingFocus: "Answer what the opponent actually said.",
    rounds: [0, 1, 2].map((index) => ({ ...GUEST_LIVE_FRAMES[index], opponent: state.opponents[index] ?? "" })) as GuestMotion["rounds"],
    retest: { ...GUEST_LIVE_RETEST_FRAME, opponent: state.retest ?? GUEST_LIVE_FALLBACK_RETEST },
  };
}

const LIVE_STATE_MAX_OPPONENTS = GUEST_LIVE_ROUNDS;

/** Validate a stored live sprint (sessionStorage). Null means not restorable. */
export function parseGuestLiveState(raw: unknown): GuestLiveState | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const motion = v.motion as Record<string, unknown> | undefined;
  if (!motion || typeof motion !== "object") return null;
  if (typeof motion.title !== "string" || !motion.title.trim() || motion.title.length > 400) return null;
  if (typeof motion.prompt !== "string" || motion.prompt.length > 2000) return null;
  if (motion.category !== null && motion.category !== undefined && typeof motion.category !== "string") return null;
  if (!Array.isArray(v.opponents) || v.opponents.length > LIVE_STATE_MAX_OPPONENTS) return null;
  const opponents: string[] = [];
  for (const text of v.opponents) {
    if (typeof text !== "string" || text.length > GUEST_LIVE_MAX_TEXT) return null;
    opponents.push(text);
  }
  if (v.retest !== null && v.retest !== undefined && (typeof v.retest !== "string" || v.retest.length > GUEST_LIVE_MAX_TEXT)) {
    return null;
  }
  return {
    motion: {
      title: motion.title,
      prompt: motion.prompt,
      category: typeof motion.category === "string" ? motion.category.slice(0, 80) : null,
    },
    persona: resolvePersona(v.persona),
    opponents,
    retest: typeof v.retest === "string" ? v.retest : null,
  };
}
