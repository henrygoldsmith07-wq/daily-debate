// Speech analysis engine — measures debating-relevant vocal characteristics
// from transcript metadata. Pure functions, no DOM, no model calls.
//
// Deliberately does NOT score: accent, pitch, tone, volume, vocal quality,
// or any other identity-related trait. Only measures what actually matters
// for debate effectiveness.

// --- types -------------------------------------------------------------------

export interface TurnTiming {
  /** ISO timestamp when the user started speaking/recording */
  startedAt: string;
  /** ISO timestamp when the user finished speaking/recording */
  endedAt: string;
  /** Duration in seconds (endedAt - startedAt, clamped to ≥ 0) */
  durationSeconds: number;
}

export interface SpeechTurnAnalysis {
  /** Words per minute — ideal range is 120–170 for debate clarity */
  paceWpm: number | null;
  /** Number of pauses ≥ 1.5s detected via sentence-gap heuristics */
  pauseCount: number;
  /** Total pause time as fraction of total duration (0..1) */
  pauseRatio: number;
  /** Filler words per 100 words ("um", "uh", "like", "you know", …) */
  fillerDensity: number;
  /** Filler word count */
  fillerCount: number;
  /** Structural signposting density per 100 words ("first", "therefore", "in conclusion") */
  structureDensity: number;
  /** Whether the turn contains a contrastive move (rebuttal marker) */
  hasContrastiveMove: boolean;
  /** Jaccard similarity with previous turn's key terms (0..1, higher = more repetitive) */
  repetitionScore: number | null;
  /** Total word count */
  wordCount: number;
}

// --- fillers -------------------------------------------------------------------

const FILLER_RE = /\b(?:um+|uh+|erm+|er+h?|like,?\s|you know|i mean|sort of|kind of|basically|literally|actually,?\s|right\?|okay so)\b/gi;

const STRUCTURE_RE = /\b(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|finally|in conclusion|to summarise|my next point|moving on|let me address|turning to|on the other hand|furthermore|moreover|in addition|consequently|therefore|as a result|for example|for instance|specifically|namely)\b/gi;

const CONTRASTIVE_RE = /\b(?:however|but|although|even if|granting|while it'?s true|admittedly|conversely|on the contrary|that said|regardless|nevertheless)\b/i;

// --- helpers ---------------------------------------------------------------

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return a.size + b.size === 0 ? 0 : inter / (a.size + b.size - inter);
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "of", "in", "to",
  "for", "with", "on", "at", "by", "from", "up", "about", "into",
  "through", "during", "before", "after", "above", "below", "between",
  "and", "but", "or", "so", "if", "then", "that", "this", "these",
  "those", "it", "its", "they", "them", "their", "he", "she", "his",
  "her", "we", "our", "you", "your", "i", "me", "my", "not", "no",
]);

function contentWords(text: string): Set<string> {
  return new Set(tokenize(text).filter((w) => w.length > 3 && !STOPWORDS.has(w)));
}

// --- main analysis -----------------------------------------------------------

/**
 * Analyse a single speech turn. Pure — takes text + timing, returns metrics.
 * `previousTurnText` enables repetition scoring against the prior turn.
 */
export function analyseSpeechTurn(
  text: string,
  timing: TurnTiming,
  previousTurnText?: string,
): SpeechTurnAnalysis {
  const tokens = tokenize(text);
  const wordCount = tokens.length;

  // Pace: words per minute
  const minutes = timing.durationSeconds / 60;
  const paceWpm = minutes > 0.08 ? Math.round(wordCount / minutes) : null; // need ≥5s

  // Fillers
  const fillerMatches = text.match(FILLER_RE) ?? [];
  const fillerCount = fillerMatches.length;
  const fillerDensity = wordCount > 0 ? Math.round((fillerCount / wordCount) * 10000) / 100 : 0;

  // Structure signposting
  const structureMatches = text.match(STRUCTURE_RE) ?? [];
  const structureDensity = wordCount > 0 ? Math.round((structureMatches.length / wordCount) * 10000) / 100 : 0;

  // Contrastive move (rebuttal signal)
  const hasContrastiveMove = CONTRASTIVE_RE.test(text);

  // Repetition vs previous turn
  let repetitionScore: number | null = null;
  if (previousTurnText && previousTurnText.trim()) {
    const prev = contentWords(previousTurnText);
    const curr = contentWords(text);
    if (prev.size > 2 && curr.size > 2) {
      repetitionScore = Math.round(jaccard(prev, curr) * 1000) / 1000;
    }
  }

  // Pause estimation: sentence boundaries that imply gaps.
  // A rough proxy: count sentences, estimate average gap between them.
  // Real pause detection needs audio waveform analysis (future).
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 3);
  const impliedGaps = Math.max(0, sentences.length - 1);
  const estimatedPauseSeconds = impliedGaps * 0.8; // avg inter-sentence micro-pause
  const pauseRatio = timing.durationSeconds > 0
    ? Math.min(1, +(estimatedPauseSeconds / timing.durationSeconds).toFixed(3))
    : 0;
  const pauseCount = impliedGaps;

  return {
    paceWpm,
    pauseCount,
    pauseRatio,
    fillerDensity,
    fillerCount,
    structureDensity,
    hasContrastiveMove,
    repetitionScore,
    wordCount,
  };
}

/** Rebuttal immediacy: seconds between opponent's turn ending and user starting. */
export function rebuttalImmediacy(opponentEndedAt: string, userStartedAt: string): number | null {
  const oppEnd = Date.parse(opponentEndedAt);
  const usrStart = Date.parse(userStartedAt);
  if (!isFinite(oppEnd) || !isFinite(usrStart)) return null;
  return Math.max(0, Math.round((usrStart - oppEnd) / 1000));
}

// --- composite score ---------------------------------------------------------

export interface SpeechQualityScore {
  overall: number; // 0..100
  breakdown: {
    paceScore: number; // 0..100
    fillerScore: number; // 0..100
    structureScore: number; // 0..100
    repetitionPenalty: number; // 0..30 (0 = no penalty)
    contrastiveBonus: number; // 0 or 10
  };
}

/**
 * Composite speech quality score. Deliberately ignores accent, pitch, tone,
 * and vocal characteristics — only measures what matters for debate:
 * pace consistency, filler discipline, structural clarity, non-repetition,
 * and whether the speaker engages with opposing points.
 */
export function scoreSpeechQuality(analysis: SpeechTurnAnalysis): SpeechQualityScore {
  // Pace: ideal band 120-170 wpm, tapering outside
  let paceScore = 50;
  if (analysis.paceWpm !== null) {
    if (analysis.paceWpm >= 120 && analysis.paceWpm <= 170) paceScore = 90;
    else if (analysis.paceWpm >= 100 && analysis.paceWpm <= 190) paceScore = 70;
    else if (analysis.paceWpm >= 80 && analysis.paceWpm <= 220) paceScore = 45;
    else paceScore = 20;
  }

  // Filler: 0% = perfect, 5%+ = poor
  const fillerScore = Math.max(0, Math.round(100 - analysis.fillerDensity * 20));

  // Structure: higher density = better (capped)
  const structureScore = Math.min(100, Math.round(analysis.structureDensity * 25));

  // Repetition: penalise high overlap
  const repetitionPenalty =
    analysis.repetitionScore !== null && analysis.repetitionScore > 0.5
      ? Math.round((analysis.repetitionScore - 0.5) * 60)
      : 0;

  // Contrastive bonus: engaging with opponent's argument
  const contrastiveBonus = analysis.hasContrastiveMove ? 10 : 0;

  const raw = paceScore * 0.3 + fillerScore * 0.3 + structureScore * 0.2 + contrastiveBonus - repetitionPenalty;
  const overall = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    overall,
    breakdown: { paceScore, fillerScore, structureScore, repetitionPenalty, contrastiveBonus },
  };
}
