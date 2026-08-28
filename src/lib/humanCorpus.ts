// Labelled benchmark corpus & inter-rater helpers.
// The repository fixture below is useful for exercising the pipeline, but its
// provenance is not independently evidenced in this checkout. Do not report
// it as a human-validity result until provenance is recorded and audited.
// Designed to scale to thousands: every LabeledDebate carries multiple independent rater
// verdicts and the helpers compute Fleiss/Cohen/Krippendorff + judge-vs-human correlation
// and calibration (ECE/Brier). The Postgres table `benchmark_corpus` mirrors this shape
// so the offline corpus and the live DB stay in sync (see migrations 003 and 005).

export type WinnerLabel = "a" | "b" | "tie";
export type RaterVerdict = { raterId: string; winner: WinnerLabel; confidence?: number; rationale?: string };
export type LabelProvenance = "verified_human" | "unverified_repository_fixture" | "synthetic";

export interface LabelProvenanceRecord {
  source: "moderated_annotation" | "repository_fixture" | "synthetic_generator";
  collectedAt?: string;
  independentlyRecorded: boolean;
  note: string;
}

export interface LabeledDebate {
  id: string;
  transcript: string;
  // Majority / adjudicated ground truth
  humanWinner: WinnerLabel;
  raterIds: string[];
  humanRationale: string;
  // Multi-rater detail: when present this is the source of truth for reliability stats.
  // If absent, `raterIds` is treated as N raters who all agreed on `humanWinner`
  // (back-compat with the original 2-item corpus and with `agreementRate` callers).
  raterVerdicts?: RaterVerdict[];
  // Optional metadata for stratification / calibration
  topic?: string;
  createdAt?: string;
  // Adjudication record (set by corpusAdjudication.adjudicateDebate)
  adjudicated?: boolean;
  adjudicatedBy?: string;
  adjudicationNote?: string;
  /** Optional until an imported corpus supplies an auditable provenance record. */
  provenance?: LabelProvenance;
  provenanceRecord?: LabelProvenanceRecord;
  isSynthetic?: boolean;
}

export interface CorpusLabelAudit {
  n: number;
  verifiedHuman: number;
  unverified: number;
  synthetic: number;
  status: "verified_human" | "unverified_fixture" | "mixed";
  canClaimHumanValidity: boolean;
  reasons: string[];
}

/** Audit label provenance before using corpus agreement as a validity claim. */
export function auditCorpusLabels(corpus: LabeledDebate[]): CorpusLabelAudit {
  const verifiedHuman = corpus.filter((item) =>
    item.provenance === "verified_human" &&
    item.provenanceRecord?.source === "moderated_annotation" &&
    item.provenanceRecord.independentlyRecorded,
  ).length;
  const synthetic = corpus.filter((item) => item.isSynthetic || item.provenance === "synthetic").length;
  const unverified = corpus.length - verifiedHuman - synthetic;
  const status: CorpusLabelAudit["status"] = verifiedHuman === corpus.length && corpus.length > 0
    ? "verified_human"
    : verifiedHuman > 0
      ? "mixed"
      : "unverified_fixture";
  const reasons: string[] = [];
  if (unverified > 0) reasons.push(`${unverified} item(s) lack an independently recorded human-annotation provenance record.`);
  if (synthetic > 0) reasons.push(`${synthetic} item(s) are synthetic and cannot establish human validity.`);
  if (verifiedHuman === 0 && corpus.length > 0) reasons.push("No repository metadata substantiates that the current fixture labels were collected from humans.");
  return { n: corpus.length, verifiedHuman, unverified, synthetic, status, canClaimHumanValidity: status === "verified_human", reasons };
}

export const HUMAN_CORPUS: LabeledDebate[] = [
  {
    id: "hc-renewables-01",
    transcript: ["Player A (round 1): Lazard LCOE solar $24/MWh vs gas $45. Cheaper new build.", "Player B (round 1): But intermittency needs backup.", "Player A (round 2): NREL storage futures 4h adder <$10/MWh—still cheaper; Brattle says grid upgrades needed anyway.", "Player B (round 2): Surveys say one thing, votes another.", "Player A (round 3): OECD/Pew 62% pay +10% for clean — cited.", "Player B (round 3): Anecdotal worry."].join("\n"),
    humanWinner: "a",
    raterIds: ["r1", "r2"],
    humanRationale: "A grounded multiple claims with Lazard/NREL/Pew; B mostly asserted.",
    raterVerdicts: [
      { raterId: "r1", winner: "a", confidence: 0.82, rationale: "Multiple cited sources vs assertion" },
      { raterId: "r2", winner: "a", confidence: 0.78, rationale: "Evidence density favours A" },
    ],
    topic: "renewables",
  },
  {
    id: "hc-ai-reg-01",
    transcript: ["Player A (round 1): No regulation—US lead vs China.", "Player B (round 1): Labs themselves want guardrails (Anthropic RSP, NIST RMF).", "Player A (round 2): Voluntary is fine.", "Player B (round 2): Stanford HAI 60% voluntary unverifiable—law needed.", "Player A (round 3): Offshoring.", "Player B (round 3): Bruegel certainty retains talent."].join("\n"),
    humanWinner: "b",
    raterIds: ["r1", "r2", "r3"],
    humanRationale: "B cited 3 institutions and rebutted directly; A asserted.",
    raterVerdicts: [
      { raterId: "r1", winner: "b", confidence: 0.9, rationale: "B cited NIST/RSP/HAI directly" },
      { raterId: "r2", winner: "b", confidence: 0.85, rationale: "A asserted, B evidenced" },
      { raterId: "r3", winner: "b", confidence: 0.8, rationale: "Direct institutional rebuttal each round" },
    ],
    topic: "ai-regulation",
  },
  {
    id: "hc-healthcare-01",
    transcript: ["Player A (round 1): Private insurance is faster and more responsive.", "Player B (round 1): WHO data: admin overhead ~20% of private spend vs ~4% single-payer.", "Player A (round 2): Waiting lists are the real problem.", "Player B (round 2): Lancet cohort: public systems equal or better outcomes on 5-year survival.", "Player A (round 3): At least choice remains.", "Player B (round 3): IMF studies find choice concentrated among the wealthy."].join("\n"),
    humanWinner: "b",
    raterIds: ["r1", "r2", "r3"],
    humanRationale: "B answered each of A's points with a cited counter; A restated without evidence.",
    raterVerdicts: [
      { raterId: "r1", winner: "b", confidence: 0.88, rationale: "Every A claim met with WHO/Lancet/IMF data" },
      { raterId: "r2", winner: "b", confidence: 0.84, rationale: "Evidence density clearly favours B" },
      { raterId: "r3", winner: "b", confidence: 0.75, rationale: "A's 'choice' point dodges the cost data" },
    ],
    topic: "healthcare",
  },
  {
    id: "hc-education-01",
    transcript: ["Player A (round 1): Streaming pupils by ability lifts everyone.", "Player B (round 1): OECD PISA analyses show no average gain and worse outcomes for lower sets.", "Player A (round 2): The brightest are held back otherwise.", "Player B (round 2): Brookings: top decile gains are small and unreliable across systems.", "Player A (round 3): Teachers prefer it.", "Player B (round 3): Reuters poll of 1,200 teachers: majority report no benefit."].join("\n"),
    humanWinner: "b",
    raterIds: ["r1", "r2", "r3"],
    humanRationale: "B counters each round with a named study; A's preferences-based claim is weaker than B's data.",
    raterVerdicts: [
      { raterId: "r1", winner: "b", confidence: 0.82, rationale: "OECD + Brookings beat preferences" },
      { raterId: "r2", winner: "b", confidence: 0.8, rationale: "A never engages the PISA analysis" },
      { raterId: "r3", winner: "a", confidence: 0.55, rationale: "Borderline: teacher preference has weight" },
    ],
    topic: "education",
  },
  {
    id: "hc-crime-01",
    transcript: ["Player A (round 1): Longer sentences cut crime by taking offenders out.", "Player B (round 1): NIST review: marginal deterrence of long sentences is near zero.", "Player A (round 2): Victims deserve justice regardless.", "Player B (round 2): That is a retribution argument, not a crime-cutting one—and it conflates aims.", "Player A (round 3): Numbers prove deterrence works.", "Player B (round 3): AP data across 12 states: no association between sentence length and recidivism."].join("\n"),
    humanWinner: "b",
    raterIds: ["r1", "r2", "r3"],
    humanRationale: "A shifts from effectiveness to retribution without conceding; B flags the shift and cites data.",
    raterVerdicts: [
      { raterId: "r1", winner: "b", confidence: 0.8, rationale: "B catches the burden-shift and cites AP" },
      { raterId: "r2", winner: "b", confidence: 0.78, rationale: "A's round 2 is a different argument than round 1" },
      { raterId: "r3", winner: "tie", confidence: 0.6, rationale: "Both argued their own case well; B's rebuttal is sharper" },
    ],
    topic: "crime",
  },
  {
    id: "hc-housing-01",
    transcript: ["Player A (round 1): Rent controls keep people in their homes.", "Player B (round 1): World Bank review: controls reduce supply, worsening long-run affordability.", "Player A (round 2): Supply is an industry excuse.", "Player B (round 2): UN Habitat data: cities with controls built ~30% less rental housing in the decade after.", "Player A (round 3): Stabilising rents helps families now.", "Player B (round 3): Short-run gains for sitting tenants, long-run losses for movers—the evidence is consistent."].join("\n"),
    humanWinner: "b",
    raterIds: ["r1", "r2", "r3"],
    humanRationale: "B frames the trade-off with two authoritative sources; A asserts intention over evidence.",
    raterVerdicts: [
      { raterId: "r1", winner: "b", confidence: 0.85, rationale: "World Bank + UN Habitat vs assertion" },
      { raterId: "r2", winner: "b", confidence: 0.82, rationale: "B engages the mechanism; A does not" },
      { raterId: "r3", winner: "b", confidence: 0.8, rationale: "Consistent evidence base on B's side" },
    ],
    topic: "housing",
  },
  {
    id: "hc-econ-01",
    transcript: ["Player A (round 1): Higher minimum wages destroy entry-level jobs.", "Player B (round 1): Brattle meta-analysis: negligible employment effects at moderate levels.", "Player A (round 2): Small businesses cannot absorb it.", "Player B (round 2): Brookings: small-business margins absorbed via prices, not layoffs.", "Player A (round 3): My sector anecdote says otherwise.", "Player B (round 3): An anecdote is not a dataset—the peer-reviewed record is stable across countries."].join("\n"),
    humanWinner: "b",
    raterIds: ["r1", "r2", "r3"],
    humanRationale: "B rebuts with a meta-analysis and a mechanism; A ends on a personal anecdote.",
    raterVerdicts: [
      { raterId: "r1", winner: "b", confidence: 0.86, rationale: "Meta-analysis outweighs anecdote" },
      { raterId: "r2", winner: "b", confidence: 0.84, rationale: "B supplies mechanism, A supplies story" },
      { raterId: "r3", winner: "b", confidence: 0.7, rationale: "Anecdote rounds rarely win on evidence" },
    ],
    topic: "economics",
  },
  {
    id: "hc-transport-01",
    transcript: ["Player A (round 1): Free public transport is a giveaway nobody asked for.", "Player B (round 1): IEA: fare-free trials lift ridership ~40% and shift car trips.", "Player A (round 2): The taxpayer foots it.", "Player B (round 2): OECD: congestion costs exceed fare revenue several times over in large cities.", "Player A (round 3): People still prefer driving.", "Player B (round 3): Pew polling: majorities favour funded transit when costs are framed honestly."].join("\n"),
    humanWinner: "b",
    raterIds: ["r1", "r2", "r3"],
    humanRationale: "B answers cost and preference objections with cited evidence each round.",
    raterVerdicts: [
      { raterId: "r1", winner: "b", confidence: 0.83, rationale: "Three named sources against assertion" },
      { raterId: "r2", winner: "b", confidence: 0.8, rationale: "A never cites anything" },
      { raterId: "r3", winner: "b", confidence: 0.78, rationale: "B directly answers each round's objection" },
    ],
    topic: "transport",
  },
  {
    id: "hc-tech-privacy-01",
    transcript: ["Player A (round 1): End-to-end encryption protects everyone, including criminals.", "Player B (round 1): NIST: encryption also protects journalists and abuse survivors from surveillance.", "Player A (round 2): Law enforcement needs a backdoor.", "Player B (round 2): Stanford HAI: mandated backdoors weaken security for everyone and are routinely exploited.", "Player A (round 3): Targeted access can be controlled.", "Player B (round 3): Reuters reporting: every 'controlled' access mechanism has leaked at scale."].join("\n"),
    humanWinner: "b",
    raterIds: ["r1", "r2", "r3"],
    humanRationale: "B turns each of A's points into a cited counter-example; A proposes mechanisms B shows failing.",
    raterVerdicts: [
      { raterId: "r1", winner: "b", confidence: 0.84, rationale: "NIST + Stanford HAI + Reuters chain" },
      { raterId: "r2", winner: "b", confidence: 0.8, rationale: "B directly addresses the mechanism claim" },
      { raterId: "r3", winner: "b", confidence: 0.82, rationale: "Security argument consistently grounded" },
    ],
    topic: "tech-regulation",
  },
];

export const HUMAN_CORPUS_AUDIT: CorpusLabelAudit = auditCorpusLabels(HUMAN_CORPUS);

// ---------------------------------------------------------------------------
// Back-compat helpers (kept exactly as before so benchmarks.test.ts stays green)
// ---------------------------------------------------------------------------

// Inter-rater: simple agreement rate (for two raters; extend to Fleiss/Krippendorff later)
export function agreementRate(labels: Array<{ r1: string; r2: string }>): number {
  if (!labels.length) return 1;
  return labels.filter((l) => l.r1 === l.r2).length / labels.length;
}

export function judgeVsHumanAgreement(judgeWinners: string[], humanWinners: string[]): number {
  if (!judgeWinners.length) return 0;
  let ok = 0;
  for (let i = 0; i < judgeWinners.length; i++) if (judgeWinners[i] === humanWinners[i]) ok++;
  return ok / judgeWinners.length;
}

// Calibration: winner score gap -> empirical win prob (toy). Real calibration uses many matches.
export function calibrationCurve(gaps: number[], outcomes: number[]): { gaps: number[]; probs: number[] } {
  // gaps: absolute score difference, outcomes: 1 if favorite won else 0
  return { gaps, probs: outcomes };
}

// Separate argument quality vs writing quality: combine groundedEvidence+rebuttal vs verbosity/clarity
import type { ArgGraph } from "./argGraph";
export function splitQuality(graph: ArgGraph): { argument: number; writing: number } {
  const claims = graph.nodes.filter((n) => n.kind === "claim").length || 1;
  const ev = graph.nodes.filter((n) => n.kind === "evidence").length;
  const reb = graph.nodes.filter((n) => n.kind === "rebuttal").length;
  const argument = Math.min(1, (ev * 0.6 + reb * 0.4) / Math.max(1, claims));
  // writing: clarity proxy — low fallacies + concision (avoid wordy filler heuristic)
  const fallacies = graph.fallacies.length;
  const writing = Math.max(0, 1 - fallacies * 0.15);
  return { argument, writing };
}

// ---------------------------------------------------------------------------
// Reliability stats for N raters × K categories (scales to thousands)
// ---------------------------------------------------------------------------

const LABELS: WinnerLabel[] = ["a", "b", "tie"];
function labelIndex(l: string): number {
  const i = LABELS.indexOf(l as WinnerLabel);
  return i === -1 ? 2 : i;
}

/**
 * Build an nItems × nCategories count matrix from the corpus' raterVerdicts.
 * Each row is one debate; each column is the count of raters who chose that label.
 */
export function ratingMatrix(corpus: LabeledDebate[]): number[][] {
  return corpus.map((d) => {
    const row = [0, 0, 0];
    const verdicts = d.raterVerdicts ?? d.raterIds.map((id) => ({ raterId: id, winner: d.humanWinner as WinnerLabel }));
    for (const v of verdicts) row[labelIndex(v.winner)]++;
    return row;
  });
}

/** Fleiss' kappa for N raters (possibly varying n per item) over K=3 categories. */
export function fleissKappa(matrix: number[][]): number {
  if (!matrix.length) return 1;
  const n = matrix.length;
  const k = matrix[0].length;
  // n_i = raters per item
  const nPerItem = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const Nbar = nPerItem.reduce((a, b) => a + b, 0) / n;
  if (Nbar <= 1) return 1;
  // p_j = proportion of all assignments to category j
  const totalAssignments = nPerItem.reduce((a, b) => a + b, 0);
  const p: number[] = [];
  for (let j = 0; j < k; j++) {
    let col = 0;
    for (let i = 0; i < n; i++) col += matrix[i][j];
    p.push(col / totalAssignments);
  }
  const Pe = p.reduce((a, pj) => a + pj * pj, 0);
  // Pi per item
  let Pbar = 0;
  for (let i = 0; i < n; i++) {
    const ni = nPerItem[i];
    if (ni <= 1) continue;
    let sum = 0;
    for (let j = 0; j < k; j++) sum += matrix[i][j] * (matrix[i][j] - 1);
    Pbar += sum / (ni * (ni - 1));
  }
  Pbar /= n;
  if (1 - Pe === 0) return 1;
  return (Pbar - Pe) / (1 - Pe);
}

/** Cohen's kappa for exactly two raters (paired labels). */
export function cohenKappa(a: WinnerLabel[], b: WinnerLabel[]): number {
  if (a.length !== b.length) throw new Error("cohenKappa: arrays must be same length");
  if (!a.length) return 1;
  let agree = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) agree++;
  const Po = agree / a.length;
  // Expected agreement from marginal distributions
  const freq = (arr: WinnerLabel[]) => {
    const m = new Map<WinnerLabel, number>();
    for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };
  const fa = freq(a), fb = freq(b);
  let Pe = 0;
  for (const lab of LABELS) Pe += ((fa.get(lab) ?? 0) / a.length) * ((fb.get(lab) ?? 0) / b.length);
  if (1 - Pe === 0) return 1;
  return (Po - Pe) / (1 - Pe);
}

/**
 * Krippendorff's alpha (nominal) for the 3-label scheme. Handles missing
 * raters (ragged rows) via the standard coincidence-matrix formulation.
 */
export function krippendorffAlpha(corpus: LabeledDebate[]): number {
  // Build coincidence counts
  const K = LABELS.length;
  const coinc = Array.from({ length: K }, () => Array(K).fill(0));
  let pairable = 0;
  for (const d of corpus) {
    const verdicts = d.raterVerdicts ?? d.raterIds.map((id) => ({ raterId: id, winner: d.humanWinner as WinnerLabel }));
    const labels = verdicts.map((v) => labelIndex(v.winner));
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      coinc[a][b] += 1;
      coinc[b][a] += 1;
      pairable += 1;
    }
  }
  if (!pairable) return 1;
  // Observed disagreement Do = weighted mismatches / pairable (nominal: 0 if same, 1 if different)
  let mismatches = 0;
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) if (i !== j) mismatches += coinc[i][j];
  // For symmetric coincidence we double-counted pairs, but mismatches already counts both triangles; divide by 2*pairable to get proportion
  const Do = mismatches / (2 * pairable || 1);
  // Expected disagreement from marginal frequencies
  const totals = coinc.map((row) => row.reduce((a, b) => a + b, 0));
  const grand = totals.reduce((a, b) => a + b, 0) || 1;
  const p = totals.map((t) => t / grand);
  const De = 1 - p.reduce((a, pj) => a + pj * pj, 0);
  if (De === 0) return 1;
  return 1 - Do / De;
}

/** Pearson r between two equal-length numeric arrays. */
export function pearsonCorrelation(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  const den = Math.sqrt(da * db);
  if (!den) return 0;
  return Math.max(-1, Math.min(1, num / den));
}

function rank(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
  const out = Array(arr.length).fill(0);
  let r = 0;
  while (r < indexed.length) {
    let s = r;
    while (s < indexed.length && indexed[s].v === indexed[r].v) s++;
    const avg = (r + s - 1) / 2 + 1;
    for (let k = r; k < s; k++) out[indexed[k].i] = avg;
    r = s;
  }
  return out;
}

/** Spearman rho (rank correlation). */
export function spearmanCorrelation(a: number[], b: number[]): number {
  return pearsonCorrelation(rank(a), rank(b));
}

/** Human vs judge winner correlation as Pearson over encoded labels (a=1,b=-1,tie=0). */
export function judgeHumanCorrelation(judge: WinnerLabel[], human: WinnerLabel[]): { pearson: number; spearman: number; agreement: number } {
  const enc = (w: WinnerLabel) => (w === "a" ? 1 : w === "b" ? -1 : 0);
  const ja = judge.map(enc), ha = human.map(enc);
  return { pearson: pearsonCorrelation(ja, ha), spearman: spearmanCorrelation(ja, ha), agreement: judgeVsHumanAgreement(judge, human) };
}

// ---------------------------------------------------------------------------
// Calibration (score gap -> win prob)
// ---------------------------------------------------------------------------

export interface CalibrationBin { count: number; avgGap: number; avgConfidence: number; empiricalWinRate: number; }
export interface CalibrationReport {
  bins: CalibrationBin[];
  ece: number; // expected calibration error
  brier: number;
  n: number;
}

/**
 * Calibration for judged matches: each match has `gap` = |scoreA-scoreB|/100 and
 * `favoriteWon` (1 if higher-scored player won per ground truth, else 0).
 * Also handles the live judge's own confidence: gap/100 is a proxy for confidence
 * until the judge emits explicit `confidence` (see uncertainty helpers).
 */
export function calibrationReport(
  gaps: number[],
  favoriteWon: number[],
  bins = 5,
): CalibrationReport {
  const n = gaps.length;
  if (!n) return { bins: [], ece: 0, brier: 0, n: 0 };
  // Bucket by gap quantile (equal-width over 0..1)
  const width = 1 / bins;
  const bucket: Array<{ gaps: number[]; outcomes: number[] }> = Array.from({ length: bins }, () => ({ gaps: [], outcomes: [] }));
  for (let i = 0; i < n; i++) {
    const g = Math.max(0, Math.min(1, gaps[i]));
    const b = Math.min(bins - 1, Math.floor(g / width));
    bucket[b].gaps.push(g);
    bucket[b].outcomes.push(favoriteWon[i]);
  }
  const binsOut: CalibrationBin[] = bucket.map((bk) => {
    if (!bk.gaps.length) return { count: 0, avgGap: 0, avgConfidence: 0, empiricalWinRate: 0 };
    const avgGap = bk.gaps.reduce((a, b) => a + b, 0) / bk.gaps.length;
    // confidence proxy = gap (larger gap => more confident favorite should win)
    const avgConfidence = avgGap;
    const empiricalWinRate = bk.outcomes.reduce((a, b) => a + b, 0) / bk.outcomes.length;
    return { count: bk.gaps.length, avgGap, avgConfidence, empiricalWinRate };
  }).filter((b) => b.count > 0);
  // ECE = weighted |confidence - empirical|
  let ece = 0;
  for (const b of binsOut) ece += (b.count / n) * Math.abs(b.avgConfidence - b.empiricalWinRate);
  // Brier = mean (confidence - outcome)^2
  let brier = 0;
  for (let i = 0; i < n; i++) { const c = Math.max(0, Math.min(1, gaps[i])); brier += (c - favoriteWon[i]) ** 2; }
  brier /= n;
  return { bins: binsOut, ece, brier, n };
}

// ---------------------------------------------------------------------------
// Corpus scale helpers (imports/exports for thousands)
// ---------------------------------------------------------------------------

export interface CorpusStats {
  n: number;
  ratersPerItem: { mean: number; min: number; max: number };
  labelDist: Record<WinnerLabel, number>;
  fleissKappa: number;
  krippendorffAlpha: number;
  byRaterPair: Array<{ a: string; b: string; cohenKappa: number; overlap: number }>;
}

export function corpusStats(corpus: LabeledDebate[]): CorpusStats {
  const n = corpus.length;
  const counts = corpus.map((d) => (d.raterVerdicts ?? []).length || d.raterIds.length);
  const mean = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
  const labelDist: Record<WinnerLabel, number> = { a: 0, b: 0, tie: 0 };
  for (const d of corpus) labelDist[d.humanWinner] = (labelDist[d.humanWinner] ?? 0) + 1;
  const matrix = ratingMatrix(corpus);
  // Pairwise Cohen for rater pairs that overlap meaningfully
  const allRaterIds = [...new Set(corpus.flatMap((d) => (d.raterVerdicts ?? []).map((v) => v.raterId).concat(d.raterIds)))];
  const byRaterPair: CorpusStats["byRaterPair"] = [];
  for (let i = 0; i < allRaterIds.length; i++) for (let j = i + 1; j < allRaterIds.length; j++) {
    const a = allRaterIds[i], b = allRaterIds[j];
    const pairs: Array<[WinnerLabel, WinnerLabel]> = [];
    for (const d of corpus) {
      const va = (d.raterVerdicts ?? []).find((v) => v.raterId === a)?.winner;
      const vb = (d.raterVerdicts ?? []).find((v) => v.raterId === b)?.winner;
      if (va && vb) pairs.push([va, vb]);
    }
    if (pairs.length >= 5) {
      byRaterPair.push({ a, b, cohenKappa: cohenKappa(pairs.map((p) => p[0]), pairs.map((p) => p[1])), overlap: pairs.length });
    }
  }
  return {
    n,
    ratersPerItem: { mean, min: Math.min(...counts, 0), max: Math.max(...counts, 0) },
    labelDist,
    fleissKappa: fleissKappa(matrix),
    krippendorffAlpha: krippendorffAlpha(corpus),
    byRaterPair,
  };
}

/**
 * Thousand-scale scaffold: generate a deterministic synthetic corpus that
 * mirrors the real label-collection schema so the pipeline can be exercised
 * today without waiting for human raters. Each synthetic item is internally
 * consistent and the corpus's reliability stats are reported alongside real data.
 * Replace entries as real labels arrive — `isSynthetic` gates inclusion in
 * reported metrics when mixing.
 */
export interface SyntheticCorpusOpts {
  n: number;
  seed?: number;
  // Agreement level to simulate: high => raters agree; medium => realistic spread
  agreement?: "high" | "medium" | "low";
  raters?: string[];
}
export function syntheticCorpus(opts: SyntheticCorpusOpts): Array<LabeledDebate & { isSynthetic: true }> {
  const raters = opts.raters ?? ["r1", "r2", "r3"];
  const n = opts.n;
  const seed = opts.seed ?? 7;
  // Simple seeded RNG
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  const topics = ["renewables", "ai-regulation", "healthcare", "education", "economics"];
  const templates: Array<{ transcript: string; winner: WinnerLabel; rationale: string }> = [
    { transcript: "Player A cites Lazard/NREL on costs. Player B asserts without data.", winner: "a", rationale: "Grounded evidence vs assertion" },
    { transcript: "Player A asserts US lead. Player B cites NIST/Stanford HAI with specifics.", winner: "b", rationale: "Institution-backed rebuttal" },
    { transcript: "Both sides balance — neither dominates; tie on impact weighing.", winner: "tie", rationale: "Even clash, no dropped threads on either side" },
    { transcript: "Player A drops B's cost-impact framing and leans on anecdote.", winner: "b", rationale: "Dropped argument cost B→A" },
    { transcript: "Player A concedes B's structural concession but pivots to impact.", winner: "a", rationale: "Concession recovered via impact comparison" },
  ];
  const agreeProb = opts.agreement === "high" ? 0.9 : opts.agreement === "low" ? 0.55 : 0.78;
  const out: Array<LabeledDebate & { isSynthetic: true }> = [];
  for (let i = 0; i < n; i++) {
    const tpl = templates[i % templates.length];
    const topic = topics[Math.floor(rnd() * topics.length)];
    // Each rater usually agrees with ground truth, occasionally dissents
    const verdicts: RaterVerdict[] = raters.map((rId) => {
      let w = tpl.winner;
      if (rnd() > agreeProb) {
        // Flip to a plausible alternative (not uniformly random — ties rarer)
        w = rnd() < 0.5 ? (w === "a" ? "b" : w === "b" ? "a" : rnd() < 0.5 ? "a" : "b") : "tie";
      }
      return { raterId: rId, winner: w, confidence: 0.55 + rnd() * 0.4, rationale: w === tpl.winner ? tpl.rationale : "Dissent: borderline call" };
    });
    // Majority determines humanWinner (deterministic in ties → original winner)
    const tally = new Map<WinnerLabel, number>();
    for (const v of verdicts) tally.set(v.winner, (tally.get(v.winner) ?? 0) + 1);
    let best: WinnerLabel = tpl.winner;
    let bestN = -1;
    for (const [k, c] of tally) if (c > bestN) { bestN = c; best = k; }
    out.push({
      id: `syn-${String(i + 1).padStart(5, "0")}`,
      transcript: `Player A (r1): ${tpl.transcript}\nPlayer B (r1): Counter with general reasoning.`,
      humanWinner: best,
      raterIds: raters,
      humanRationale: tpl.rationale,
      raterVerdicts: verdicts,
      topic,
      createdAt: new Date(Date.now() - Math.floor(rnd() * 30 * 86400000)).toISOString(),
      provenance: "synthetic",
      provenanceRecord: { source: "synthetic_generator", independentlyRecorded: false, note: "Generated by syntheticCorpus for pipeline tests; not a human label." },
      isSynthetic: true as const,
    });
  }
  return out;
}

