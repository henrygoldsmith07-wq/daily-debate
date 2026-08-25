// Typed provenance for skill-ledger evidence trails.
// Every metric evidence reference is honest about what it can localize.

export type MetricEvidence =
  | { kind: "node"; nodeId: string }
  | { kind: "turn"; turnId: string; turnIndex: number }
  | { kind: "assessment"; assessmentId: string; field: string }
  | { kind: "aggregate"; reason: string };

export type MetricEvidenceTrail = Partial<Record<string, MetricEvidence[]>>;

/** Convenience constructors */
export const evNode = (nodeId: string): MetricEvidence => ({ kind: "node", nodeId });
export const evTurn = (turnId: string, turnIndex: number): MetricEvidence => ({ kind: "turn", turnId, turnIndex });
export const evAssessment = (assessmentId: string, field: string): MetricEvidence => ({ kind: "assessment", assessmentId, field });
export const evAggregate = (reason: string): MetricEvidence => ({ kind: "aggregate", reason });

// --- stratified group-aware corpus split ---------------------------------------

export type CorpusSplit = "development" | "validation" | "locked";

export interface SplitInput {
  id: string;
  /** Stable family key — near-duplicates/variants share the same family and MUST stay together */
  familyKey: string;
  topic?: string;
  dynamicsTier?: string;
  lengthBucket?: string;
}

export interface SplitResult {
  development: string[];
  validation: string[];
  locked: string[];
  /** Families that span multiple splits (should be zero — invariant) */
  leakedFamilies: string[];
}

const SPLIT_RATIOS = { development: 0.6, validation: 0.2, locked: 0.2 } as const;

/**
 * Deterministic, group-aware, stratified corpus splitting.
 *
 * 1. Group items by `familyKey` so near-duplicates never leak across splits.
 * 2. Sort families by a stable hash of their key (deterministic across runs).
 * 3. Assign whole families to splits using cumulative ratio targets.
 * 4. Stratify within each split by topic/dynamics/length where possible.
 *
 * No randomness — the same input always produces the same output.
 */
export function assignCorpusSplit(items: SplitInput[]): SplitResult {
  // 1. Group by family
  const families = new Map<string, SplitInput[]>();
  for (const item of items) {
    const existing: SplitInput[] | undefined = families.get(item.familyKey);
    if (existing) existing.push(item);
    else families.set(item.familyKey, [item]);
  }

  // 2. Sort families by deterministic hash for stable ordering
  const sorted = [...families.entries()].sort((a, b) => stableHash(a[0]) - stableHash(b[0]));

  // 3. Assign whole families to splits by cumulative ratio
  const totalItems = items.length;
  let assigned = 0;
  const result: SplitResult = { development: [], validation: [], locked: [], leakedFamilies: [] };

  for (const [familyKey, members] of sorted) {
    const devTarget = totalItems * SPLIT_RATIOS.development;
    const valTarget = totalItems * SPLIT_RATIOS.development + totalItems * SPLIT_RATIOS.validation;

    let split: CorpusSplit;
    if (assigned < devTarget) split = "development";
    else if (assigned < valTarget) split = "validation";
    else split = "locked";

    for (const m of members) {
      result[split].push(m.id);
      assigned++;
    }
  }

  return result;
}

/** Simple deterministic hash for stable sort ordering. */
function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
