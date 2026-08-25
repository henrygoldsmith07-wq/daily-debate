// Adaptive debate coach: turns the skill ledger into a seven-dimension
// ARGUMENT SKILL PROFILE, picks today's training focus (movement-aware, so
// improving dimensions are deprioritised and drills that don't produce
// improvement stop being recommended), and scores drill attempts with a
// deterministic rubric. Pure — routes handle persistence.

import { trajectoryFor, type SkillMetricPoint, type MetricKey } from "./skillLedger";
import { classifyFallacies } from "./graphEnrichers";

export type CoachDimension =
  | "evidence"
  | "rebuttal"
  | "logic"
  | "clarity"
  | "impact"
  | "steelmanning"
  | "structure";

export const COACH_DIMENSIONS: CoachDimension[] = [
  "evidence",
  "rebuttal",
  "logic",
  "clarity",
  "impact",
  "steelmanning",
  "structure",
];

export const DIMENSION_LABELS: Record<CoachDimension, string> = {
  evidence: "Evidence",
  rebuttal: "Rebuttal",
  logic: "Logic",
  clarity: "Clarity",
  impact: "Impact",
  steelmanning: "Steelmanning",
  structure: "Structure",
};

/** Which ledger metric backs each coach dimension. */
const DIMENSION_METRIC: Record<CoachDimension, MetricKey> = {
  evidence: "evidenceGrounding",
  rebuttal: "rebuttalCoverage",
  logic: "fallacyRate",
  clarity: "clarity",
  impact: "impactHandling",
  steelmanning: "steelmanQuality",
  structure: "droppedArguments",
};

export interface CoachDim {
  key: CoachDimension;
  label: string;
  score: number | null; // 0..100
  hasData: boolean;
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function dimScore(points: SkillMetricPoint[], metric: MetricKey): number | null {
  const values = points.map((p) => p.metrics[metric]).filter((v): v is number => v !== null);
  const mean = avg(values);
  if (mean === null) return null;
  // fallacyRate / droppedArguments are "bad" quantities on 0..~1 scales.
  if (metric === "fallacyRate") return Math.round(Math.max(0, 100 - mean * 250));
  if (metric === "droppedArguments") return Math.round(Math.max(0, 100 - mean * 40));
  return Math.round(mean * 100);
}

export function buildCoachProfile(points: SkillMetricPoint[]): {
  dims: CoachDim[];
  slopes: Record<CoachDimension, number | null>;
} {
  const dims = COACH_DIMENSIONS.map((key) => {
    let score: number | null;
    if (key === "structure") {
      // Structure composes the two structural failure counts.
      const dropped = avg(points.map((p) => p.metrics.droppedArguments).filter((v): v is number => v !== null));
      const contradictions = avg(points.map((p) => p.metrics.contradictions).filter((v): v is number => v !== null));
      score =
        dropped === null && contradictions === null
          ? null
          : Math.max(0, Math.round(100 - 25 * ((dropped ?? 0) + (contradictions ?? 0))));
    } else {
      score = dimScore(points, DIMENSION_METRIC[key]);
    }
    return { key, label: DIMENSION_LABELS[key], score, hasData: score !== null };
  });

  const slopes = Object.fromEntries(
    COACH_DIMENSIONS.map((key) => {
      const t = trajectoryFor(points, DIMENSION_METRIC[key]);
      return [key, t.slopePerDebate];
    }),
  ) as Record<CoachDimension, number | null>;

  return { dims, slopes };
}

/**
 * Focus selection: lowest dimension wins, adjusted by movement — a dimension
 * already improving gets lifted away from focus (don't fix what's fixing
 * itself); a regressing one sinks.
 */
export function selectFocus(
  dims: CoachDim[],
  slopes: Partial<Record<CoachDimension, number | null>>,
  outcomes: Partial<Record<CoachDimension, number>> = {},
): { focus: CoachDim | null; reason: string } {
  const usable = dims.filter((d) => d.hasData && d.score !== null);
  if (!usable.length) return { focus: null, reason: "No scored debates yet — complete a debate to unlock training." };

  // Hard-skip dimensions whose recent drills produced negative movement —
  // stop recommending drills that aren't producing improvement.
  const nonProducing = new Set(
    Object.entries(outcomes)
      .filter(([, delta]) => delta < -0.02)
      .map(([key]) => key),
  );
  const pool = usable.filter((d) => !nonProducing.has(d.key));
  if (!pool.length) pool.push(...usable); // all struggling: fall back to least-bad

  const adjusted = pool.map((d) => {
    const slope = slopes[d.key] ?? 0;
    // Improving dimensions rise away from focus (don't fix what's fixing itself).
    const boost = Math.max(-8, Math.min(12, slope * 400));
    return { dim: d, score: d.score as number, effective: (d.score as number) + boost };
  });
  adjusted.sort((a, b) => a.effective - b.effective);
  const worst = adjusted[0];
  const reasonBits: string[] = [`lowest profile dimension (${worst.score}/100)`];
  const slope = slopes[worst.dim.key] ?? null;
  if (slope !== null && slope < 0) reasonBits.push("and trending down");
  return { focus: worst.dim, reason: reasonBits.join(", ") };
}

// ---------------------------------------------------------------------------
// Drill library — every prompt asks for observable, scoreable moves and fits
// a 2-5 minute window.
// ---------------------------------------------------------------------------

export interface DrillTemplate {
  minutes: 2 | 3 | 5;
  title: string;
  prompt: string;
}

export const DRILL_LIBRARY: Record<CoachDimension, DrillTemplate[]> = {
  evidence: [
    { minutes: 2, title: "Ground one claim", prompt: "Write one sentence making a claim about energy costs, then cite a real institution (e.g. Lazard or NREL) whose data supports it." },
    { minutes: 5, title: "Three-source ladder", prompt: "Take any opinion you hold about education policy. Support it with three sentences, each citing a different real institution for a distinct piece of evidence." },
  ],
  rebuttal: [
    { minutes: 2, title: "Close the gap", prompt: "Your opponent claims remote work reduces productivity. Write a two-sentence rebuttal that targets their exact mechanism rather than restating your side." },
    { minutes: 5, title: "Target and turn", prompt: "Pick your last debate's strongest opposing point. In four sentences: restate it fairly, then rebut its key assumption with one cited fact, and state why your answer matters more." },
  ],
  logic: [
    { minutes: 2, title: "Fallacy surgery", prompt: "Rewrite this without the fallacy: 'Everyone knows nuclear is dangerous, so we should ban it.' Keep the same conclusion using a causal claim plus evidence." },
    { minutes: 5, title: "Assumption hunt", prompt: "Write an argument for cheaper public transport, naming its single most vulnerable hidden assumption and defending it in one sentence." },
  ],
  clarity: [
    { minutes: 2, title: "Half the words", prompt: "Rewrite your longest sentence from your last debate in half the words without losing the claim or the evidence citation." },
    { minutes: 3, title: "One-idea lines", prompt: "Explain a policy you support in exactly three short sentences: claim, mechanism, impact. No sentence over twenty words." },
  ],
  impact: [
    { minutes: 2, title: "Weigh it", prompt: "Two impacts: household cost savings vs grid reliability risk. Write one sentence saying which matters more and WHY, with an explicit comparison word." },
    { minutes: 5, title: "Impact stack", prompt: "Choose a policy. List two impacts, then write a weighing sentence that compares magnitude AND likelihood, ending with which side wins the round." },
  ],
  steelmanning: [
    { minutes: 2, title: "Best case first", prompt: "State the strongest version of the argument AGAINST school choice in one sentence starting 'Even if...', then explain why your side still wins." },
    { minutes: 3, title: "Concede and pivot", prompt: "Name one point from your last debate you should concede. Write: the concession, then the pivot showing why your case survives it." },
  ],
  structure: [
    { minutes: 3, title: "No orphans", prompt: "List every claim you made in your last debate. Mark any your opponent never addressed. Write the missing rebuttal for the most important orphan." },
    { minutes: 5, title: "Signpost rebuild", prompt: "Rebuild your last argument as three labelled moves — Claim, Support, Impact — each one sentence, nothing dangling." },
  ],
};

/** Deterministic day rotation so "today's drill" varies without randomness. */
export function todaysDrill(dim: CoachDimension, dateIso: string): DrillTemplate {
  const day = Number(dateIso.slice(0, 10).replaceAll("-", "")) || 0;
  const lib = DRILL_LIBRARY[dim];
  return lib[day % lib.length];
}

// ---------------------------------------------------------------------------
// Attempt scoring — deterministic rubric, same detectors the judge uses.
// ---------------------------------------------------------------------------

export interface AttemptScore {
  score: number; // 0..100
  signals: string[];
}

const CONTRASTIVE_RE = /\b(however|but|even if|granting|while|although|yet|conversely|on the contrary)\b/i;
const WEIGHING_RE = /\b(outweighs?|more important|matters more|bigger (?:deal|impact)|higher stakes|first order|second order)\b/i;
const KNOWN_SOURCE_RE = /\b(Lazard|NREL|Pew|Brookings|NIST|Nature|Reuters|OECD|IEA|IMF|WHO|AP|Stanford HAI)\b/i;
const WEASEL_FREE_OK = true;

export function scoreAttempt(dim: CoachDimension, text: string): AttemptScore {
  const signals: string[] = [];
  const words = (text.match(/[A-Za-z0-9']+/g) ?? []).length;
  let score = 0;

  if (words >= 15 && words <= 140) {
    score += 15;
    signals.push("substantive length");
  }
  if (CONTRASTIVE_RE.test(text)) {
    score += 15;
    signals.push("engages the opposing move");
  }
  if (KNOWN_SOURCE_RE.test(text)) {
    score += 20;
    signals.push("cites a real institution");
  }
  if (WEIGHING_RE.test(text)) {
    score += 15;
    signals.push("explicit weighing");
  }
  if (!/\b(?:always|never|everyone knows|obviously|definitely)\b/i.test(text)) {
    score += 10;
    signals.push("no absolute-language crutch");
  } else {
    signals.push("absolute language detected");
  }

  const dimBonus: Record<CoachDimension, () => number> = {
    evidence: () => (KNOWN_SOURCE_RE.test(text) ? 25 : 0),
    rebuttal: () => (/targets?|their (?:claim|mechanism|assumption)|restating/i.test(text) ? 25 : 0),
    logic: () => (classifyFallacies(text).length === 0 ? 25 : 0),
    clarity: () => {
      const sentences = text.split(/[.!?]+/).filter((s) => s.trim());
      const longOnes = sentences.filter((s) => (s.match(/\S+/g) ?? []).length > 22).length;
      return sentences.length >= 2 && longOnes === 0 ? 25 : 0;
    },
    impact: () => (WEIGHING_RE.test(text) ? 25 : 0),
    steelmanning: () => (/\b(?:even if|granting|strongest version|concede)/i.test(text) ? 25 : 0),
    structure: () =>
      /\b(?:claim|support|impact|first|second|finally|orphan|signpost)\b/i.test(text) ? 25 : 0,
  };
  const bonus = dimBonus[dim]();
  score += bonus;
  if (bonus > 0) signals.push(`${DIMENSION_LABELS[dim]} move present`);

  void WEASEL_FREE_OK;
  return { score: Math.min(100, score), signals };
}

// ---------------------------------------------------------------------------
// Skill movement around a drill assignment
// ---------------------------------------------------------------------------

export interface MovementResult {
  before: number | null;
  after: number | null;
  delta: number | null; // goodness terms: positive = improved
}

export function movementAround(
  points: SkillMetricPoint[],
  dim: CoachDimension,
  atIso: string,
  window = 2,
): MovementResult | null {
  const metric = DIMENSION_METRIC[dim];
  const idx = points.findIndex((p) => p.completedAt >= atIso);
  if (idx === -1 || points.length < 2) return null;
  const val = (p: SkillMetricPoint): number | null => {
    const raw = p.metrics[metric];
    if (raw === null) return null;
    const badMetric = metric === "fallacyRate" || metric === "droppedArguments";
    return badMetric ? 1 - Math.min(1, raw) : raw; // goodness-normalised where possible
  };
  const beforeSlice = points.slice(Math.max(0, idx - window), idx).map(val).filter((v): v is number => v !== null);
  const afterSlice = points.slice(idx + 1, idx + 1 + window).map(val).filter((v): v is number => v !== null);
  if (!beforeSlice.length || !afterSlice.length) return null;
  const before = +(beforeSlice.reduce((s, v) => s + v, 0) / beforeSlice.length).toFixed(3);
  const after = +(afterSlice.reduce((s, v) => s + v, 0) / afterSlice.length).toFixed(3);
  return { before, after, delta: +(after - before).toFixed(3) };
}
