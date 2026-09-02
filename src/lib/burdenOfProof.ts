// burdenOfProof.ts — how much a claim has to prove, and whether it did.
//
// `detectBurdenShifts` in graphEnrichers.ts spots the phrase "you must prove".
// That catches someone SAYING the words and nothing else. Burden of proof is
// not a phrase, it is a property of the claim: "social media harms teenagers"
// and "social media has harmed some teenagers" are the same topic and nowhere
// near the same claim to defend.
//
// Two things are modelled here, both structural and both offline:
//
// 1. **How heavy a claim's burden is**, from its own logical form — universal
//    scope, causal assertion, normative "should", or a bare existence claim.
// 2. **Whether that burden was discharged**, by looking at what actually
//    supports the node in the graph, and holding heavier claims to more.
//
// From those two, the thing debate coaches actually care about falls out:
// an *improper burden shift* — demanding the opponent disprove a claim you
// have not supported yourself. The existing regex cannot tell that from a
// perfectly legitimate demand for proof, because the words are identical.
//
// Every judgement here is observable from the graph. Nothing is inferred about
// what a debater believed or intended, and a claim whose form cannot be read
// is `descriptive` with a moderate burden rather than being guessed at.

import type { ArgGraph, ArgNode, Owner } from "./argGraph";
import { detectBurdenShifts, type BurdenShift } from "./graphEnrichers";

/** The logical form of a claim, which is what sets its burden. */
export type ClaimKind = "universal" | "causal" | "normative" | "existential" | "descriptive";

/** How much support the claim's form demands. */
export type BurdenLevel = "heavy" | "moderate" | "light";

/** Whether the support present is proportionate to that demand. */
export type BurdenVerdict = "met" | "partially-met" | "unmet";

export interface BurdenClassification {
  kind: ClaimKind;
  level: BurdenLevel;
  /** The observable cues that set this, quoted from the claim. */
  reasons: string[];
}

export interface ClaimBurden {
  nodeId: string;
  owner: Owner;
  round: number;
  text: string;
  kind: ClaimKind;
  level: BurdenLevel;
  reasons: string[];
  /** Evidence nodes supporting this claim, by id. */
  supportIds: string[];
  /** Support that carried at least one citation. */
  citedSupport: number;
  verdict: BurdenVerdict;
  explanation: string;
}

export interface ImproperShift extends BurdenShift {
  /** The unsupported claim of their own the demand was made behind. */
  unsupportedClaimId: string;
  claimText: string;
  explanation: string;
}

export interface BurdenReport {
  claims: ClaimBurden[];
  /** Explicit "you must prove" moments, whether proper or not. */
  shifts: BurdenShift[];
  /** The subset that demanded disproof of the speaker's own unsupported claim. */
  improperShifts: ImproperShift[];
  byOwner: Record<string, { claims: number; heavy: number; unmet: number; improperShifts: number }>;
  /** One plain sentence, or null when the graph carries no claims. */
  summary: string | null;
}

// Scope words that turn a claim into one about every case, which is the
// hardest thing to defend and the easiest to refute with one counterexample.
const UNIVERSAL = /\b(all|every|always|never|no one|nobody|none|any(one|body)?|invariably|without exception|universally|inevitably)\b/i;
// Hedges that pull a claim back from universal scope.
const HEDGE = /\b(some|many|most|often|sometimes|can|could|may|might|tends? to|in some cases|generally|typically|usually)\b/i;
// Asserted causation, as opposed to reported association.
const CAUSAL = /\b(causes?|caused|causing|leads? to|results? in|because of|due to|drives?|makes? (people|them|us)|is responsible for|produces?)\b/i;
// Association language, which asks less than causation does.
const CORRELATIONAL = /\b(correlat\w+|associated with|linked to|goes along with|tracks with)\b/i;
// A claim about what ought to be, which needs a value premise as well as facts.
const NORMATIVE = /\b(should|ought|must|need to|has to|immoral|unethical|wrong to|right to|obligation|duty)\b/i;
// A claim that one case exists — discharged by one example.
const EXISTENTIAL = /\b(at least one|there (are|is) (some|cases|instances)|some cases|an example|exists?)\b/i;

/**
 * Read a claim's logical form.
 *
 * Order matters and is deliberate: universal scope dominates, because "social
 * media always harms teenagers" is a universal claim whether or not it also
 * asserts causation, and it is the universality that decides what would refute
 * it. Normative outranks causal for the same reason — "we should ban X because
 * it causes Y" cannot be discharged by proving Y alone.
 */
export function classifyBurden(text: string): BurdenClassification {
  const value = String(text ?? "");
  const reasons: string[] = [];
  const quote = (re: RegExp) => value.match(re)?.[0]?.toLowerCase();

  const universal = UNIVERSAL.test(value);
  const hedged = HEDGE.test(value);
  const causal = CAUSAL.test(value);
  const correlational = CORRELATIONAL.test(value);
  const normative = NORMATIVE.test(value);
  const existential = EXISTENTIAL.test(value);

  if (universal && !hedged) {
    reasons.push(`asserts every case ("${quote(UNIVERSAL)}") — a single counterexample refutes it`);
    if (causal) reasons.push(`and asserts causation ("${quote(CAUSAL)}")`);
    return { kind: "universal", level: "heavy", reasons };
  }

  if (normative) {
    reasons.push(`asserts what ought to be ("${quote(NORMATIVE)}") — needs a value premise, not only evidence`);
    if (causal) reasons.push(`resting on a causal claim ("${quote(CAUSAL)}")`);
    return { kind: "normative", level: "heavy", reasons };
  }

  if (causal) {
    reasons.push(`asserts causation ("${quote(CAUSAL)}"), which needs more than an association`);
    if (hedged) reasons.push(`hedged ("${quote(HEDGE)}"), which lowers what must be shown`);
    return { kind: "causal", level: hedged ? "moderate" : "heavy", reasons };
  }

  if (existential) {
    reasons.push(`claims only that a case exists ("${quote(EXISTENTIAL)}") — one example discharges it`);
    return { kind: "existential", level: "light", reasons };
  }

  if (correlational) {
    reasons.push(`asserts an association ("${quote(CORRELATIONAL)}") rather than a cause`);
    return { kind: "descriptive", level: "moderate", reasons };
  }

  if (hedged) {
    reasons.push(`hedged ("${quote(HEDGE)}"), so it claims less than a flat assertion`);
    return { kind: "descriptive", level: "light", reasons };
  }

  reasons.push("a flat assertion of fact");
  return { kind: "descriptive", level: "moderate", reasons };
}

/** Evidence nodes that support a node, via a `supports` edge in either direction. */
function supportFor(graph: ArgGraph, nodeId: string): ArgNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const ids = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.relation !== "supports") continue;
    if (edge.to === nodeId) ids.add(edge.from);
    else if (edge.from === nodeId) ids.add(edge.to);
  }
  return [...ids].map((id) => byId.get(id)).filter((n): n is ArgNode => !!n && n.kind === "evidence");
}

/** How many independent pieces of evidence a level demands before it is met. */
const REQUIRED: Record<BurdenLevel, number> = { heavy: 2, moderate: 1, light: 1 };

/**
 * Whether a claim discharged its own burden.
 *
 * Heavier claims are held to more, and to better: a heavy claim supported only
 * by uncited evidence is partially met, not met. This is the whole point of
 * modelling the level — a single anecdote settles "some teenagers were harmed"
 * and settles nothing about "social media always harms teenagers".
 */
export function assessClaim(graph: ArgGraph, node: ArgNode): ClaimBurden {
  const { kind, level, reasons } = classifyBurden(node.text);
  const support = supportFor(graph, node.id);
  const citedSupport = support.filter((e) => (e.citations?.length ?? 0) > 0
    || e.evidenceStrength === "cited" || e.evidenceStrength === "strong").length;
  const required = REQUIRED[level];

  let verdict: BurdenVerdict;
  let explanation: string;
  if (support.length === 0) {
    verdict = "unmet";
    explanation = `No evidence supports this ${kind} claim, which ${reasons[0]}.`;
  } else if (support.length < required) {
    verdict = "partially-met";
    explanation = `A ${level}-burden claim carrying ${support.length} of the ${required} supporting pieces it needs.`;
  } else if (level === "heavy" && citedSupport === 0) {
    verdict = "partially-met";
    explanation = `Supported, but none of the ${support.length} pieces carries a citation — thin for a claim that ${reasons[0]}.`;
  } else {
    verdict = "met";
    explanation = `Supported by ${support.length} piece${support.length === 1 ? "" : "s"} of evidence`
      + `${citedSupport > 0 ? `, ${citedSupport} cited` : ""}.`;
  }

  return {
    nodeId: node.id,
    owner: node.owner,
    round: node.round,
    text: node.text,
    kind,
    level,
    reasons,
    supportIds: support.map((e) => e.id),
    citedSupport,
    verdict,
    explanation,
  };
}

/**
 * Demands for proof that were made from behind an unsupported claim of the
 * speaker's own.
 *
 * This is the distinction the phrase-matching detector cannot draw. "You must
 * prove that" is legitimate when the speaker has met their own burden and is
 * asking the opponent to meet theirs. It is a burden shift when the speaker
 * has asserted something unsupported in the same round or earlier and is
 * demanding it be disproved instead of supporting it.
 */
export function findImproperShifts(graph: ArgGraph, claims: ClaimBurden[]): ImproperShift[] {
  const shifts = detectBurdenShifts(graph.nodes);
  const out: ImproperShift[] = [];
  for (const shift of shifts) {
    const own = claims
      .filter((c) => c.owner === shift.by && c.verdict === "unmet" && c.round <= shift.round)
      .sort((a, b) => b.round - a.round);
    const target = own[0];
    if (!target) continue;
    out.push({
      ...shift,
      unsupportedClaimId: target.nodeId,
      claimText: target.text,
      explanation: `Demanded proof in round ${shift.round} while their own claim "${target.text.slice(0, 60)}"`
        + " (round " + target.round + ") is still unsupported. Asking the other side to disprove it"
        + " does not discharge their burden.",
    });
  }
  return out;
}

/** Full burden picture for a graph. */
export function burdenReport(graph: ArgGraph): BurdenReport {
  const nodes = graph?.nodes ?? [];
  const claimNodes = nodes.filter((n) => n.kind === "claim" || n.kind === "counterclaim");
  const claims = claimNodes.map((node) => assessClaim(graph, node));
  const shifts = detectBurdenShifts(nodes);
  const improperShifts = findImproperShifts(graph, claims);

  const byOwner: BurdenReport["byOwner"] = {};
  for (const claim of claims) {
    const row = byOwner[claim.owner] ?? { claims: 0, heavy: 0, unmet: 0, improperShifts: 0 };
    row.claims += 1;
    if (claim.level === "heavy") row.heavy += 1;
    if (claim.verdict === "unmet") row.unmet += 1;
    byOwner[claim.owner] = row;
  }
  for (const shift of improperShifts) {
    const row = byOwner[shift.by] ?? { claims: 0, heavy: 0, unmet: 0, improperShifts: 0 };
    row.improperShifts += 1;
    byOwner[shift.by] = row;
  }

  let summary: string | null = null;
  if (claims.length > 0) {
    const unmet = claims.filter((c) => c.verdict === "unmet").length;
    const heavyUnmet = claims.filter((c) => c.level === "heavy" && c.verdict === "unmet").length;
    const parts = [`${claims.length} claim${claims.length === 1 ? "" : "s"} assessed`];
    parts.push(unmet === 0 ? "all carried some support" : `${unmet} carried no support`);
    if (heavyUnmet > 0) {
      parts.push(`${heavyUnmet} of those ${heavyUnmet === 1 ? "was a universal, causal or normative claim" : "were universal, causal or normative claims"}`);
    }
    if (improperShifts.length > 0) {
      parts.push(`${improperShifts.length} demand${improperShifts.length === 1 ? "" : "s"} for proof came from behind an unsupported claim`);
    }
    summary = `${parts.join("; ")}.`;
  }

  return { claims, shifts, improperShifts, byOwner, summary };
}
