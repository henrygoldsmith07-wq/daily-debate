/**
 * Claims pulled out of a finished debate, each attributed to whoever made it
 * (the Geo pattern: every argument becomes a list of claims you can look at
 * on their own).
 *
 * The tag says how a claim is PHRASED, never whether it is true:
 *   - "checkable": it names something that could be looked up — a number, a
 *     year, a percentage, or a source ("according to", "a study", "data").
 *   - "opinion": it is a value judgement or a recommendation ("should",
 *     "better", "unfair", "I think").
 *   - "claim": neither cue is present; it is an assertion, unlabelled.
 * Deterministic and local: no model call, so the same text always produces
 * the same list, and nothing here can be mistaken for a fact-check.
 */
export type ClaimKind = "checkable" | "opinion" | "claim";

export interface ClaimSource {
  /** Who said it, as the screen names them ("You", "Opponent", a username). */
  speaker: string;
  /** The side that speaker argued, when known. */
  side: "for" | "against" | null;
  round: number;
  text: string | null | undefined;
}

export interface Claim {
  id: string;
  speaker: string;
  side: "for" | "against" | null;
  round: number;
  text: string;
  kind: ClaimKind;
}

const MIN_WORDS = 5;
const MAX_CLAIM_CHARS = 280;

const CHECKABLE = [
  /\b\d[\d,.]*\s*(%|percent|per cent|million|billion|thousand|k\b|m\b|bn\b)/i,
  /\b(1[89]|20)\d{2}\b/,
  /[£$€]\s?\d/,
  /\baccording to\b/i,
  /\b(a|the|one|this|recent|new)\s+(study|survey|report|review|trial|census|poll|meta-analysis)\b/i,
  /\b(studies|surveys|reports|data|statistics|figures|research)\s+(show|shows|found|finds|suggest|suggests|indicate|indicates)\b/i,
  /\b(found that|reported that|measured|doubled|halved|tripled)\b/i,
];

const OPINION = [
  /\b(should|shouldn't|should not|ought to|must|mustn't)\b/i,
  /\b(i think|i believe|i feel|in my view|in my opinion|we need to)\b/i,
  /\b(better|worse|best|worst|fairer|unfair|fair|wrong|right to|immoral|moral|deserve|deserves|important|matters more)\b/i,
];

/** Split prose into sentence-sized claims without breaking "Dr." or "3.5". */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function classifyClaim(sentence: string): ClaimKind {
  if (CHECKABLE.some((pattern) => pattern.test(sentence))) return "checkable";
  if (OPINION.some((pattern) => pattern.test(sentence))) return "opinion";
  return "claim";
}

function isAssertion(sentence: string): boolean {
  if (sentence.endsWith("?")) return false;
  return sentence.split(/\s+/).filter(Boolean).length >= MIN_WORDS;
}

export function extractClaims(sources: ClaimSource[]): Claim[] {
  const claims: Claim[] = [];
  for (const source of sources) {
    if (!source.text) continue;
    splitSentences(source.text).forEach((sentence, index) => {
      if (!isAssertion(sentence)) return;
      const text = sentence.length > MAX_CLAIM_CHARS ? `${sentence.slice(0, MAX_CLAIM_CHARS - 1).trimEnd()}…` : sentence;
      claims.push({
        id: `${source.speaker}-${source.round}-${index}`,
        speaker: source.speaker,
        side: source.side,
        round: source.round,
        text,
        kind: classifyClaim(sentence),
      });
    });
  }
  return claims;
}

export function claimCounts(claims: Claim[]): Record<ClaimKind, number> {
  const counts: Record<ClaimKind, number> = { checkable: 0, opinion: 0, claim: 0 };
  for (const claim of claims) counts[claim.kind] += 1;
  return counts;
}
