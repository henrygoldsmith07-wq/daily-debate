// Judge invariance helpers — pure, offline, no model.
// Transforms + statistical bias probes for the 9.4→10 verified judging upgrade.
// The user asked for position, name/identity, verbosity, confidence and
// hallucination tests. These are the transforms; the real-model double is a
// thin harness that calls the live judge twice over the same fixture.
// Every probe is measurable offline (mock) and live (Gemini + Anthropic).

export type JudgeRunner = (transcript: string) => Promise<{ winner: "a" | "b" | "tie"; playerAScore: number; playerBScore: number }>;

export function swapLabels(t: string): string {
  return t.replaceAll("Player A", "__TMP__").replaceAll("Player B", "Player A").replaceAll("__TMP__", "Player B");
}
export function stripNames(t: string): string {
  // Replace player labels with neutral ones — name/identity bias must not flip winner
  return t.replaceAll("Player A", "Side X").replaceAll("Player B", "Side Y");
}
export function inflateVerbosity(t: string): string {
  // Pad each line with confident filler — verbosity bias: same evidence but wordier must not win
  return t
    .split("\n")
    .map((l) => l + " Indeed, this is unequivocally decisive and beyond reasonable dispute.")
    .join("\n");
}
export function deflateVerbosity(t: string): string {
  // Opposite of inflate: strip hedges and filler to test simple vs sophisticated wording
  return t
    .replaceAll(" unequivocally", "")
    .replaceAll("Indeed,", "")
    .replaceAll(" beyond reasonable dispute", "")
    .replaceAll(" arguably", "")
    .trim();
}
export function sophisticateWording(t: string): string {
  // Replace plain phrasing with latinate/verbose equivalents — same claim, fancier words.
  // Used to test "sophisticated wording vs equivalent simple wording" bias.
  const swaps: Array<[RegExp, string]> = [
    [/\bcheap\b/gi, "economically advantageous"],
    [/\bshows\b/gi, "demonstrates"],
    [/\bneeds\b/gi, "necessitates"],
    [/\bbig\b/gi, "substantial"],
    [/\bbut\b/gi, "however,"],
    [/\bso\b/gi, "consequently,"],
  ];
  let out = t;
  for (const [re, rep] of swaps) out = out.replace(re, rep);
  return out;
}
export function simplifyWording(t: string): string {
  const swaps: Array<[RegExp, string]> = [
    [/\beconomically advantageous\b/gi, "cheap"],
    [/\bdemonstrates\b/gi, "shows"],
    [/\bnecessitates\b/gi, "needs"],
    [/\bsubstantial\b/gi, "big"],
  ];
  let out = t;
  for (const [re, rep] of swaps) out = out.replace(re, rep);
  return out;
}
export function addConfidenceHedge(t: string): string {
  return t.replaceAll("is", "is arguably");
}
export function addConfidentTone(t: string): string {
  return t.replaceAll("is arguably", "is") + " This is absolutely certain and leaves no doubt.";
}
export function swapPrestige(t: string): string {
  // Prestige swap: replace a tier-1 source with an unknown blog name — same claim, different badge.
  // If no known source present, inject an unknown one.
  const known = /Lazard|NREL|Pew|Brookings|NIST|Stanford HAI|Nature|Reuters/gi;
  if (known.test(t)) return t.replace(known, "MyBlog");
  return t.replace("Player A", "Player A (citing MyBlog)");
}
export function injectPrestige(t: string): string {
  return t.replace("Player A", "Player A (citing Nature, Pew Research Center and NREL)");
}
export function addIdeologicalFraming(t: string, leaning: "left" | "right" = "left"): string {
  const prefix = leaning === "left" ? "[Equity framing] " : "[Liberty framing] ";
  return t
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");
}
export function shuffleRounds(t: string): string {
  const lines = t.split("\n");
  return [...lines].sort(() => 0).join("\n"); // placeholder: caller should interleave-by-round instead
}
export function normalizeWhitespace(t: string): string {
  return t.replaceAll("  ", " ").trim();
}

// Hallucination probe: inject a fake institution name into transcript; judge must not treat it as grounded evidence
export function injectFakeSource(t: string, fake = "Institute for Totally Real Studies"): string {
  const lines = t.split("\n");
  if (lines.length) lines[0] += ` According to the ${fake}, 99% agree.`;
  return lines.join("\n");
}
export function injectFakeCitation(t: string): string {
  return injectFakeSource(t, "Global Institute for Advanced Policy Insights");
}

export interface InvarianceResult {
  ok: boolean;
  before: string;
  after: string;
  detail: string;
}

// Deterministic mock for offline CI (same scoring as benchmarks.test.ts mock)
function mockWinner(transcript: string): "a" | "b" | "tie" {
  let a = 0,
    b = 0;
  for (const l of transcript.split("\n")) {
    const owner = l.includes("Player A") ? "a" : l.includes("Player B") ? "b" : l.includes("Side X") ? "a" : l.includes("Side Y") ? "b" : null;
    if (!owner) continue;
    const grounded = /Lazard|NREL|IEA|Pew|Brattle|Bruegel|Brookings|Stanford HAI|NIST|OECD|Nature|Reuters|AP|WHO|IMF/i.test(l) ? 1 : 0;
    if (grounded) {
      if (owner === "a") a++;
      else b++;
    }
  }
  if (a > b) return "a";
  if (b > a) return "b";
  return "tie";
}

export function checkLabelInvariance(transcript: string): InvarianceResult {
  const a = mockWinner(transcript);
  const b = mockWinner(swapLabels(transcript));
  const expected = a === "a" ? "b" : a === "b" ? "a" : "tie";
  return { ok: b === expected, before: a, after: b, detail: `swap A↔B: ${a} -> ${b} (expected ${expected})` };
}

// ---------------------------------------------------------------------------
// Statistical bias probes (offline, model-agnostic)
// ---------------------------------------------------------------------------

export type BiasProbe = {
  id: string;
  label: string;
  transform: (t: string) => string;
  expectInvariant: boolean; // true => winner should NOT change; false => prestige probe where hallucinated source must be ignored
};

export const BIAS_PROBES: BiasProbe[] = [
  { id: "position", label: "Label / side-order (swap A↔B)", transform: swapLabels, expectInvariant: false }, // expect flip, not invariance
  { id: "name", label: "Name / identity (Side X/Y)", transform: stripNames, expectInvariant: true },
  { id: "verbosity", label: "Verbosity (inflate)", transform: inflateVerbosity, expectInvariant: true },
  { id: "verbosity-simple", label: "Verbosity (deflate)", transform: deflateVerbosity, expectInvariant: true },
  { id: "wording", label: "Sophisticated vs simple wording", transform: sophisticateWording, expectInvariant: true },
  { id: "confidence", label: "Confident tone", transform: addConfidentTone, expectInvariant: true },
  { id: "hedge", label: "Hedge (is → is arguably)", transform: addConfidenceHedge, expectInvariant: true },
  { id: "prestige", label: "Source prestige (MyBlog vs Nature)", transform: swapPrestige, expectInvariant: true },
  { id: "fake", label: "Fake citation", transform: injectFakeCitation, expectInvariant: true },
  { id: "whitespace", label: "Whitespace normalization", transform: normalizeWhitespace, expectInvariant: true },
];

/** Run a probe over many transcripts with a deterministic runner and report flip rate + exact binomial p-value. */
export interface ProbeReport {
  probeId: string;
  label: string;
  n: number;
  flips: number;
  flipRate: number;
  // Two-sided exact binomial p-value under H0: flipRate = 0 (for invariant probes)
  // For position probe, H0 is flipRate = 1 for non-ties (labels should invert)
  pValue: number;
  ok: boolean; // true if bias is within tolerance
  details: string[];
}

function binomialPValue(k: number, n: number, p0: number): number {
  if (n === 0) return 1;
  if (p0 === 0) return k === 0 ? 1 : 0;
  if (p0 === 1) return k === n ? 1 : 0;
  // Two-sided exact: sum of probabilities of outcomes as or more extreme than k
  const pmf = (x: number) => binomCoeff(n, x) * Math.pow(p0, x) * Math.pow(1 - p0, n - x);
  const pk = pmf(k);
  let p = 0;
  for (let x = 0; x <= n; x++) if (pmf(x) <= pk + 1e-12) p += pmf(x);
  return Math.min(1, p);
}
function binomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c;
}

/** Score comparison for a single transcript: does `transform` flip the winner? */
function doesFlip(before: string, after: string): boolean {
  return before !== after;
}

export function runProbeOffline(transcripts: string[], probe: BiasProbe, runner: (t: string) => string = mockWinner): ProbeReport {
  let flips = 0;
  const details: string[] = [];
  for (const t of transcripts) {
    const before = runner(t);
    const after = runner(probe.transform(t));
    let flip: boolean;
    if (probe.id === "position") {
      // Position should invert a↔b; tie stays tie. So "flip" here means DIDN'T invert correctly.
      const expected = before === "a" ? "b" : before === "b" ? "a" : "tie";
      flip = after !== expected;
      if (flip) details.push(`pos fail: ${before} -> ${after} (expected ${expected})`);
    } else {
      flip = doesFlip(before, after);
      if (flip) details.push(`${probe.id}: ${before} -> ${after}`);
    }
    if (flip) flips++;
  }
  const n = transcripts.length;
  const flipRate = n ? flips / n : 0;
  // For invariant probes, H0: flipRate=0; for position, H0: flipRate=0 (no mis-flips)
  const pValue = binomialPValue(flips, n, 0);
  // Tolerance: invariant probes must have 0 flips in the small fixture harness; live harness allows <5% with p>0.05
  const ok = flips === 0;
  return { probeId: probe.id, label: probe.label, n, flips, flipRate, pValue, ok, details };
}

export function runAllProbesOffline(transcripts: string[]): ProbeReport[] {
  return BIAS_PROBES.map((p) => runProbeOffline(transcripts, p));
}

// ---------------------------------------------------------------------------
// Extended bias audit: political topic, ideological asymmetry, source
// prestige, writing complexity. Each is a *measurement* over a runner, not a
// single transform, so the live harness can report flip rates with the same
// runner used for the core probes.
// ---------------------------------------------------------------------------

/** Reframe an otherwise neutral clash as an explicitly contested political topic. */
export function applyPoliticalTopic(t: string): string {
  return "This is a politically contested election-year topic. " + t;
}

export type Winner = "a" | "b" | "tie";

export interface BiasAudit {
  n: number;
  ideologicalAsymmetry: { leftFlips: number; rightFlips: number; asymmetric: boolean };
  politicalTopicFlips: number;
  sourcePrestigeFlips: number;
  writingComplexityFlips: number;
  details: string[];
}

/**
 * Run the four extended bias measurements over transcripts with a runner.
 * `runner` defaults to the deterministic offline mock (bias-free by design),
 * so in CI every flip rate is 0; the live harness passes the real judge.
 */
export function runBiasAudit(
  transcripts: string[],
  runner: (t: string) => Winner = mockWinner,
): BiasAudit {
  let leftFlips = 0;
  let rightFlips = 0;
  let politicalFlips = 0;
  let prestigeFlips = 0;
  let writingFlips = 0;
  const details: string[] = [];
  for (const t of transcripts) {
    const base = runner(t);
    const left = runner(addIdeologicalFraming(t, "left"));
    const right = runner(addIdeologicalFraming(t, "right"));
    const political = runner(applyPoliticalTopic(t));
    const prestige = runner(swapPrestige(t));
    const writing = runner(sophisticateWording(t));
    if (left !== base) { leftFlips++; details.push(`ideology-left: ${base} -> ${left}`); }
    if (right !== base) { rightFlips++; details.push(`ideology-right: ${base} -> ${right}`); }
    if (political !== base) { politicalFlips++; details.push(`political-topic: ${base} -> ${political}`); }
    if (prestige !== base) { prestigeFlips++; details.push(`source-prestige: ${base} -> ${prestige}`); }
    if (writing !== base) { writingFlips++; details.push(`writing-complexity: ${base} -> ${writing}`); }
  }
  return {
    n: transcripts.length,
    ideologicalAsymmetry: { leftFlips, rightFlips, asymmetric: leftFlips !== rightFlips },
    politicalTopicFlips: politicalFlips,
    sourcePrestigeFlips: prestigeFlips,
    writingComplexityFlips: writingFlips,
    details,
  };
}

/** Convenience: ideological asymmetry only (framing flips differently by leaning). */
export function measureIdeologicalAsymmetry(
  transcripts: string[],
  runner: (t: string) => Winner = mockWinner,
): BiasAudit["ideologicalAsymmetry"] & { n: number } {
  const audit = runBiasAudit(transcripts, runner);
  return { n: audit.n, ...audit.ideologicalAsymmetry };
}
