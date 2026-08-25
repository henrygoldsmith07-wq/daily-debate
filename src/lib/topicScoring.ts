// Topic scoring rubric — 9 dimensions, deterministic, offline.
// Scores candidate topics so the pre-generation pipeline can pick the
// strongest rather than shipping whatever the model produced first.
// Every dimension is explainable and testable.

export interface TopicCandidate {
  title: string;
  prompt: string;
  category: string;
}

export interface TopicScoreBreakdown {
  debatableBalance: number; // 0-10: both sides defensible
  evidenceAvailability: number; // 0-10: real institutions likely to have data
  novelty: number; // 0-10: not similar to recent titles
  specificity: number; // 0-10: concrete enough to argue, not vague
  ageAppropriateness: number; // 0-10: safe for a general audience
  factualGrounding: number; // 0-10: anchored to verifiable facts, not pure opinion
  ideologicalLoading: number; // 0-10: low loading = high score
  sourceDiversity: number; // 0-10: multiple distinct source domains
  recentSimilarityPenalty: number; // 0-10 penalty (0 = totally novel)
  total: number; // weighted composite
  notes: string[];
}

// --- keyword sets ----------------------------------------------------------

const BALANCED_MARKERS = [
  "should", "whether", "is the right", "better than", "worth",
  "justify", "trade-off", "balance", "versus", "vs",
];
const ONE_SIDED_MARKERS = [
  "obviously", "everyone knows", "clearly bad", "clearly good",
  "without question", "no debate",
];
const VAGUE_WORDS = new Set([
  "things", "stuff", "society", "world", "future", "people",
  "life", "way", "aspect", "area", "issue", "topic", "matter",
]);
const EVIDENCE_DOMAINS = [
  "technology", "science", "economics", "education", "health",
  "environment", "energy", "policy", "ethics", "infrastructure",
  "transport", "agriculture", "medicine", "privacy", "security",
];
const IDEOLOGICAL_FLASHPOINTS = [
  "abortion", "gun control", "immigration ban", "border wall",
  "transgender athletes", "election fraud", "religion in schools",
  "prayer in school", "capital punishment", "assault weapons ban",
];
const ADULT_THEMES = [
  "sexual", "pornograph", "prostitution", "drug legalization",
  "casino", "gambling age", "drinking age",
];
const GENERIC_TITLE_RE = /^(should we|is it|do you|what if|the future of)/i;

// --- scoring dimensions ----------------------------------------------------

export function scoreDebatableBalance(candidate: TopicCandidate): number {
  const text = `${candidate.title} ${candidate.prompt}`.toLowerCase();
  let score = 5; // neutral baseline
  for (const marker of BALANCED_MARKERS) {
    if (text.includes(marker)) { score += 2; break; }
  }
  for (const marker of ONE_SIDED_MARKERS) {
    if (text.includes(marker)) { score -= 4; break; }
  }
  // Topics that name a specific policy or mechanism are more debatable than broad values questions
  if (/\b(ban|mandate|subsidiz|legali[sz]|regulat|restrict|limit)\b/i.test(text)) score += 1;
  return Math.max(0, Math.min(10, score));
}

export function scoreEvidenceAvailability(candidate: TopicCandidate): number {
  const cat = candidate.category.toLowerCase();
  const text = `${candidate.title} ${candidate.prompt}`.toLowerCase();
  let score = 3;
  for (const domain of EVIDENCE_DOMAINS) {
    if (cat.includes(domain) || text.includes(domain)) { score += 3; break; }
  }
  // Quantifiable terms suggest data exists
  if (/\b(cost|rate|percentage|number|data|study|research|statistics|measure)\b/i.test(text)) score += 3;
  // Named institutions or agencies boost confidence
  if (/\b(university|institute|department|agency|bureau|center|foundation|commission)\b/i.test(text)) score += 2;
  return Math.max(0, Math.min(10, score));
}

export function scoreNovelty(candidate: TopicCandidate, recentTitles: string[]): number {
  const words = new Set(
    candidate.title.toLowerCase().match(/[a-z]{4,}/g) ?? []
  );
  let maxOverlap = 0;
  for (const recent of recentTitles) {
    const rw = new Set(recent.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    if (!rw.size) continue;
    let overlap = 0;
    for (const w of words) if (rw.has(w)) overlap++;
    const jaccard = overlap / (words.size + rw.size - overlap);
    if (jaccard > maxOverlap) maxOverlap = jaccard;
  }
  return Math.round(Math.max(0, Math.min(10, (1 - maxOverlap * 2.5) * 10)));
}

export function scoreRecentSimilarityPenalty(candidate: TopicCandidate, recentTitles: string[]): number {
  const words = new Set(candidate.title.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  let maxJaccard = 0;
  for (const recent of recentTitles) {
    const rw = new Set(recent.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    if (!rw.size) continue;
    let overlap = 0;
    for (const w of words) if (rw.has(w)) overlap++;
    const jaccard = overlap / (words.size + rw.size - overlap);
    if (jaccard > maxJaccard) maxJaccard = jaccard;
  }
  return Math.round(Math.min(10, maxJaccard * 12));
}

export function scoreSpecificity(candidate: TopicCandidate): number {
  const title = candidate.title;
  const prompt = candidate.prompt;
  let score = 3;
  // Length as proxy for detail (too short = vague, reasonable length = specific)
  if (title.length >= 25 && title.length <= 100) score += 2;
  if (prompt.length >= 40 && prompt.length <= 300) score += 2;
  // Contains a concrete noun / policy lever
  if (/\b(?:ban|require|fund|tax|subsid|limit|allow|prohibit|mandate|restrict|invest|expand|reduce|increase)\b/i.test(prompt)) score += 2;
  // Penalise vague placeholder nouns
  const words = prompt.toLowerCase().match(/[a-z]+/g) ?? [];
  const vagueCount = words.filter((w) => VAGUE_WORDS.has(w)).length;
  score -= Math.min(3, vagueCount);
  // Generic title opener is a red flag
  if (GENERIC_TITLE_RE.test(title)) score -= 1;
  return Math.max(0, Math.min(10, score));
}

export function scoreAgeAppropriateness(candidate: TopicCandidate): number {
  const text = `${candidate.title} ${candidate.prompt}`.toLowerCase();
  for (const theme of ADULT_THEMES) {
    if (text.includes(theme)) return 2;
  }
  return 10;
}

export function scoreFactualGrounding(candidate: TopicCandidate): number {
  const prompt = candidate.prompt.toLowerCase();
  let score = 4;
  // Empirical language anchors the debate in checkable reality
  if (/\b(data|evidence|study|research|statistics|analysis|report|finding|measure)\b/.test(prompt)) score += 3;
  if (/\b(increase|decrease|higher|lower|faster|slower|more|less|fewer)\b/.test(prompt)) score += 2;
  // Purely philosophical/moral framings without empirical hooks score lower
  if (/^\s*is it (?:morally|ethically) (?:right|wrong|justifiable)/.test(prompt)) score -= 2;
  if (/\b(feel|opinion|believe|think)\b/.test(prompt) && !/data|evidence|study/.test(prompt)) score -= 1;
  return Math.max(0, Math.min(10, score));
}

export function scoreIdeologicalLoading(candidate: TopicCandidate): number {
  const text = `${candidate.title} ${candidate.prompt}`.toLowerCase();
  let flashpoints = 0;
  for (const fp of IDEOLOGICAL_FLASHPOINTS) {
    if (text.includes(fp)) flashpoints++;
  }
  if (flashpoints === 0) return 9;
  if (flashpoints === 1) return 6;
  return 2;
}

export function scoreSourceDiversity(candidate: TopicCandidate): number {
  const cat = candidate.category.toLowerCase();
  const text = `${candidate.title} ${candidate.prompt}`.toLowerCase();
  const touched = new Set<string>();
  for (const domain of EVIDENCE_DOMAINS) {
    if (cat.includes(domain) || text.includes(domain)) touched.add(domain);
  }
  // Cross-domain topics draw from more diverse sources
  return Math.max(0, Math.min(10, touched.size * 3 + 1));
}

// --- composite -------------------------------------------------------------

const WEIGHTS: Record<keyof Omit<TopicScoreBreakdown, "total" | "notes">, number> = {
  debatableBalance: 1.8,
  evidenceAvailability: 1.5,
  novelty: 1.2,
  specificity: 1.2,
  ageAppropriateness: 1.0,
  factualGrounding: 1.5,
  ideologicalLoading: 1.3,
  sourceDiversity: 0.8,
  recentSimilarityPenalty: -1.0, // negative weight: higher penalty = lower total
};

/** Score a single topic candidate across all dimensions. Pure — no I/O. */
export function scoreTopic(candidate: TopicCandidate, recentTitles: string[]): TopicScoreBreakdown {
  const debatableBalance = scoreDebatableBalance(candidate);
  const evidenceAvailability = scoreEvidenceAvailability(candidate);
  const novelty = scoreNovelty(candidate, recentTitles);
  const specificity = scoreSpecificity(candidate);
  const ageAppropriateness = scoreAgeAppropriateness(candidate);
  const factualGrounding = scoreFactualGrounding(candidate);
  const ideologicalLoading = scoreIdeologicalLoading(candidate);
  const sourceDiversity = scoreSourceDiversity(candidate);
  const recentSimilarityPenalty = scoreRecentSimilarityPenalty(candidate, recentTitles);

  const dims: Record<string, number> = {
    debatableBalance, evidenceAvailability, novelty, specificity,
    ageAppropriateness, factualGrounding, ideologicalLoading,
    sourceDiversity, recentSimilarityPenalty,
  };

  let weightedSum = 0;
  let weightTotal = 0;
  for (const [dim, w] of Object.entries(WEIGHTS)) {
    weightedSum += dims[dim] * w;
    weightTotal += Math.abs(w);
  }
  const total = Math.round((weightedSum / weightTotal) * 100) / 100;

  const notes: string[] = [];
  if (debatableBalance < 4) notes.push("may be one-sided");
  if (evidenceAvailability < 4) notes.push("thin evidence base");
  if (novelty < 4) notes.push("similar to a recent topic");
  if (specificity < 4) notes.push("vague framing");
  if (ageAppropriateness < 5) notes.push("adult theme");
  if (ideologicalLoading < 5) notes.push("politically loaded");
  if (recentSimilarityPenalty > 5) notes.push("high similarity to recent topics");

  return {
    debatableBalance, evidenceAvailability, novelty, specificity,
    ageAppropriateness, factualGrounding, ideologicalLoading,
    sourceDiversity, recentSimilarityPenalty, total, notes,
  };
}

/**
 * Pick the strongest candidate by total score. Ties broken by higher
 * evidence availability, then higher debatable balance.
 */
export function pickBestCandidate(
  candidates: TopicCandidate[],
  recentTitles: string[],
): { candidate: TopicCandidate; breakdown: TopicScoreBreakdown } | null {
  if (!candidates.length) return null;
  let best: { candidate: TopicCandidate; breakdown: TopicScoreBreakdown } | null = null;
  for (const c of candidates) {
    const b = scoreTopic(c, recentTitles);
    if (
      !best ||
      b.total > best.breakdown.total ||
      (b.total === best.breakdown.total &&
        (b.evidenceAvailability > best.breakdown.evidenceAvailability ||
          (b.evidenceAvailability === best.breakdown.evidenceAvailability &&
            b.debatableBalance > best.breakdown.debatableBalance)))
    ) {
      best = { candidate: c, breakdown: b };
    }
  }
  return best;
}
