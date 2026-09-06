// Post-debate targeted drills + repeated weakness profiles.
// Pure — driven by the last arg graph and recent history. Now a real
// adaptive coach: 7-dimension skill profile, measurable drill outcomes,
// and automatic deprioritisation of drills that don't move the needle.

export type DrillFocus = "evidence"|"rebuttal"|"logic"|"clarity"|"impact"|"steelmanning"|"structure";
export type Drill = { id: string; title: string; prompt: string; focus: DrillFocus; minutes?: number; };

export function drillsFor(graph: { evidenceStats: { unsupportedClaimIds: string[] }; dropped: unknown[]; fallacies: unknown[]; impactComparison: unknown; contradictions?: unknown[]; concessions?: unknown[] }): Drill[] {
  const out: Drill[] = [];
  if (graph.evidenceStats.unsupportedClaimIds.length) out.push({ id: "d-evidence", title: "Ground one claim", prompt: "Pick one unsupported claim from the debate and add a cited source for it. One sentence + citation.", focus: "evidence", minutes: 2 });
  if ((graph.dropped as unknown[]).length) out.push({ id: "d-rebuttal", title: "Close a dropped thread", prompt: "An opponent argument went unanswered — write the rebuttal you would add. Target the exact claim, not a strawman.", focus: "rebuttal", minutes: 3 });
  if ((graph.fallacies as unknown[]).length) {
    const hasSteelmanIssue = (graph.fallacies as Array<{fallacy?: string}>).some(f => f.fallacy === "strawman" || f.fallacy === "ad_hominem");
    if (hasSteelmanIssue) out.push({ id: "d-steelman", title: "Steel-man first", prompt: "Restate the opponent's argument in its strongest form in one sentence, then rebut that version.", focus: "steelmanning", minutes: 3 });
    out.push({ id: "d-logic", title: "Fix the fallacy", prompt: "Rewrite the flagged move without the fallacy — keep the conclusion, change the reasoning.", focus: "logic", minutes: 2 });
  }
  if (!graph.impactComparison) out.push({ id: "d-impact", title: "Weigh the impacts", prompt: "Compare which outcome matters more and why — one sentence with 'outweighs' or 'matters more because'.", focus: "impact", minutes: 2 });
  const contradictions = (graph as {contradictions?: unknown[]}).contradictions as unknown[] | undefined;
  const droppedLen = (graph.dropped as unknown[]).length;
  if ((contradictions && contradictions.length) || droppedLen > 1) out.push({ id: "d-structure", title: "Rebuild the structure", prompt: "Map your last debate: claim → evidence → rebuttal → impact. Fill the missing link you dropped.", focus: "structure", minutes: 4 });
  if (!out.some(d => d.focus === "clarity")) {
    // Clarity is always trainable — offer a brevity drill when nothing else fires
    if (out.length === 0) out.push({ id: "d-clarity", title: "Tighten it", prompt: "Take your longest sentence from the debate and rewrite it in half the words without losing meaning.", focus: "clarity", minutes: 2 });
  }
  return out;
}

// 7-dimension skill profile — higher is better (0-100)
// Evidence, Rebuttal, Logic, Clarity, Impact, Steelmanning, Structure
export interface WeaknessProfile { evidence: number; rebuttal: number; logic: number; clarity: number; impact: number; steelmanning: number; structure: number; }
export interface SkillProfile { evidence: number; rebuttal: number; logic: number; clarity: number; impact: number; steelmanning: number; structure: number; }
export interface DrillRecord extends Drill {
  assignedAt: number; // ms
  beforeSkill: number | null; // 0-100 skill at assignment time for its focus
  attemptText?: string;
  attemptScore?: number | null; // 0-100 scored attempt
  scoredAt?: number;
  laterSkill?: number | null; // skill measured N debates later
  movement?: number | null; // laterSkill - beforeSkill
  improved?: boolean | null;
}

/**
 * Aggregate across recent graphs: rate of debates showing each weakness.
 * Now tracks all 7 dimensions. Clarity is measured from turn-level display
 * scores when supplied; otherwise it stays at 0 until measured.
 */
export function weaknessProfile(
  graphs: Array<{ evidenceStats: { unsupportedClaimIds: string[] }; dropped: unknown[]; fallacies: unknown[]; impactComparison?: unknown; contradictions?: unknown[]; concessions?: unknown[] }>,
  opts?: { clarityScores?: Array<number | null> },
): WeaknessProfile {
  const n = Math.max(1, graphs.length);
  let ev=0, rb=0, lg=0, im=0, st=0, sr=0;
  for (const g of graphs) {
    ev += g.evidenceStats.unsupportedClaimIds.length > 0 ? 1 : 0;
    rb += (g.dropped as unknown[]).length > 0 ? 1 : 0;
    const fallacies = g.fallacies as Array<{fallacy?: string}>;
    lg += fallacies.length > 0 ? 1 : 0;
    st += fallacies.some(f => f.fallacy === "strawman" || f.fallacy === "ad_hominem" || f.fallacy === "false_dilemma") ? 1 : 0;
    im += !g.impactComparison ? 1 : 0;
    const contradictions = (g as {contradictions?: unknown[]}).contradictions as unknown[] | undefined;
    sr += ((g.dropped as unknown[]).length > 1 || (contradictions && contradictions.length > 0)) ? 1 : 0;
  }
  let clarity = 0;
  if (opts?.clarityScores?.length) {
    const valid = opts.clarityScores.filter((c): c is number => typeof c === "number");
    if (valid.length) {
      const mean = valid.reduce((s, c) => s + c, 0) / valid.length;
      clarity = Math.max(0, Math.min(1, 1 - mean / 10));
    }
  }
  return {
    evidence: +(ev/n).toFixed(3),
    rebuttal: +(rb/n).toFixed(3),
    logic: +(lg/n).toFixed(3),
    clarity: +clarity.toFixed(3),
    impact: +(im/n).toFixed(3),
    steelmanning: +(st/n).toFixed(3),
    structure: +(sr/n).toFixed(3),
  };
}

export function skillProfileFromWeakness(w: WeaknessProfile): SkillProfile {
  const toSkill = (weakness: number) => Math.round((1 - weakness) * 100);
  return {
    evidence: toSkill(w.evidence),
    rebuttal: toSkill(w.rebuttal),
    logic: toSkill(w.logic),
    clarity: toSkill(w.clarity),
    impact: toSkill(w.impact),
    steelmanning: toSkill(w.steelmanning),
    structure: toSkill(w.structure),
  };
}

export function topWeakness(p: WeaknessProfile): DrillFocus | null {
  const entries = Object.entries(p) as Array<[DrillFocus, number]>;
  entries.sort((a,b)=> b[1]-a[1]);
  return entries[0]?.[1] > 0.25 ? entries[0][0] : null;
}

// --- Adaptive coach: measurable drills ---

/** Today's training focus: weakest skill with drill-outcome awareness. */
export function todaysFocus(skill: SkillProfile, history: DrillRecord[] = []): { focus: DrillFocus; reason: string } | null {
  const entries = Object.entries(skill) as Array<[DrillFocus, number]>;
  entries.sort((a,b)=> a[1]-b[1]);
  // Filter out focuses where last 2 drills showed no improvement
  const viable = entries.filter(([focus]) => shouldRecommendDrill(focus, history));
  const pool = viable.length ? viable : entries;
  const weakest = pool[0];
  if (!weakest || weakest[1] >= 82) return null; // already strong across board
  const reasons: Record<DrillFocus, string> = {
    evidence: "unsupported claims keep appearing",
    rebuttal: "dropped threads keep recurring",
    logic: "fallacies detected recently",
    clarity: "clarity scores trending low",
    impact: "impacts rarely weighed",
    steelmanning: "strawman-style moves detected",
    structure: "arguments lose structure across turns",
  };
  return { focus: weakest[0], reason: reasons[weakest[0]] };
}

/**
 * Score a drill attempt 0-100 on effort and structure (pure).
 *
 * Keyword-free by design: the previous version awarded focus bonuses for the
 * mere presence of single words ("according to", "outweigh", "strongest"),
 * which was trivially gamed by listing the words without making an argument.
 * The rubric is now structural — length, sentence structure, development,
 * specificity — plus deliverable checks that verify the artefact the drill
 * actually asked for (a resolvable citation for evidence drills, brevity for
 * clarity drills). A coherent 25-word answer with a link outscores a keyword
 * stuffed blob.
 */
export function scoreDrillAttempt(drill: Drill, text: string): number {
  const t = text.trim();
  if (!t || t.length < 10) return 0;
  let score = 0;
  // Effort: length adequacy, scaled by drill duration
  const len = t.length;
  const minLen = drill.minutes && drill.minutes >= 4 ? 80 : 30;
  if (len >= minLen) score += 25;
  if (len >= minLen + 40) score += 10;
  // Structure: more than one sentence means claim + support, not a fragment
  const sentences = t.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length >= 2) score += 15;
  // Development: enough words to actually develop the point
  const words = t.split(/\s+/).length;
  if (words >= 25) score += 10;
  // Specificity: concrete numbers or a resolvable link, not pure assertion
  if (/\d|https?:\/\/|www\./.test(t)) score += 15;
  // Multi-sentence without run-ons (a 30+ word sentence fails a 2-minute drill's purpose)
  if (sentences.length >= 2 && sentences.every((s) => s.split(/\s+/).length <= 30)) score += 10;
  // Deliverable checks: verify the artefact requested, not magic words
  if (drill.focus === "evidence" && /https?:\/\/|www\.|\(\s*source|\bper [A-Z]/.test(t)) score += 25;
  if (drill.focus === "clarity" && words <= 25) score += 15;
  return Math.min(100, Math.round(score));
}

/** Compute movement for drills that have a later skill measurement. */
export function attachMovement(drill: DrillRecord, laterSkill: number | null): DrillRecord {
  if (drill.beforeSkill == null || laterSkill == null) return { ...drill, laterSkill, movement: null, improved: null };
  const movement = laterSkill - drill.beforeSkill;
  return { ...drill, laterSkill, movement, improved: movement > 3 };
}

/** Should we still recommend this focus? Stop if last 2 of this focus showed no improvement. */
export function shouldRecommendDrill(focus: DrillFocus, history: DrillRecord[]): boolean {
  const sameFocus = history.filter(d => d.focus === focus && d.movement != null);
  if (sameFocus.length < 2) return true;
  const recent = sameFocus.slice(-2);
  return !recent.every(d => d.improved === false);
}
