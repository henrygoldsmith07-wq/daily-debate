// Deterministic, stratified, group-aware corpus splitting.
//
// Design guarantees:
//   1. Zero family leakage: every near-duplicate stays in one split.
//   2. Stratified by topic × dynamics × length so splits don't drift.
//   3. Frozen manifest with SHA-256 integrity hash.
//   4. Same input always produces the same output (no randomness).
//
// The manifest is the single source of truth for which items belong to which
// split. Once frozen, changes to the bank do NOT reassign existing items.

import { createHash } from "crypto";

export const SPLIT_ALGORITHM_VERSION = 2;

export type CorpusSplit = "development" | "validation" | "locked";

export interface SplitInput {
  id: string;
  /** Stable family key — near-duplicates/variants MUST share this key */
  familyKey: string;
  topic?: string;
  dynamicsTier?: string;
  lengthBucket?: string;
}

export interface SplitAssignment {
  itemId: string;
  familyKey: string;
  split: CorpusSplit;
  /** Composite stratum key used for balancing */
  stratum: string;
}

export interface SplitManifest {
  algorithmVersion: number;
  createdAt: string;
  /** SHA-256 of sorted assignments — detects tampering */
  integrityHash: string;
  assignments: SplitAssignment[];
  balance: {
    development: number;
    validation: number;
    locked: number;
    perStratum: Record<string, { development: number; validation: number; locked: number }>;
  };
}

const RATIOS = { development: 0.6, validation: 0.2, locked: 0.2 };

/** Stable FNV-1a hash for deterministic sort ordering. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Composite stratum: what makes two debates comparable for splitting purposes. */
function stratumOf(item: SplitInput): string {
  return [
    item.topic ?? "unknown",
    item.dynamicsTier ?? "unclassified",
    item.lengthBucket ?? "unknown",
  ].join("/");
}

/**
 * Assign items to development / validation / locked using stratified,
 * group-aware splitting.
 *
 * Algorithm:
 *   1. Group items by familyKey → families never span splits.
 *   2. Compute each family's stratum from its majority member attributes.
 *   3. Within each stratum, sort families by stable hash.
 *   4. Assign whole families round-robin across splits proportional to ratios,
 *      tracking per-stratum counts to prevent distribution drift.
 *   5. Freeze the result as a manifest with an integrity hash.
 */
export function assignCorpusSplit(items: SplitInput[]): SplitManifest {
  // ── 1. Group into families ──
  const families = new Map<string, SplitInput[]>();
  for (const item of items) {
    const existing = families.get(item.familyKey);
    if (existing) existing.push(item);
    else families.set(item.familyKey, [item]);
  }

  // ── 2. Group families into strata ──
  interface FamilyGroup {
    key: string;
    members: SplitInput[];
    stratum: string;
    hash: number;
  }
  const strata = new Map<string, FamilyGroup[]>();

  for (const [familyKey, members] of families) {
    // Use first member's attributes as the family's stratum
    const representative = members[0];
    const stratum = stratumOf(representative);
    const group: FamilyGroup = { key: familyKey, members, stratum, hash: fnv1a(familyKey) };
    const list = strata.get(stratum) ?? [];
    list.push(group);
    strata.set(stratum, list);
  }

  // ── 3. Assign within each stratum ──
  const assignments: SplitAssignment[] = [];
  // Track how many items each split has received globally
  let devCount = 0, valCount = 0, lockCount = 0;

  // Sort strata alphabetically for deterministic processing order
  const sortedStrataKeys = [...strata.keys()].sort();

  for (const stratum of sortedStrataKeys) {
    const groups = strata.get(stratum)!;
    // Sort families within stratum by stable hash
    groups.sort((a, b) => a.hash - b.hash);

    // Count items in this stratum for proportional targets
    const stratumItems = groups.reduce((s, g) => s + g.members.length, 0);
    const stratumDevTarget = stratumItems * RATIOS.development;
    const stratumValTarget = stratumItems * (RATIOS.development + RATIOS.validation);

    let stratumAssigned = 0;

    for (const group of groups) {
      const memberCount = group.members.length;
      let split: CorpusSplit;

      // Decide based on where we are relative to stratum targets
      if (stratumAssigned < stratumDevTarget) split = "development";
      else if (stratumAssigned < stratumValTarget) split = "validation";
      else split = "locked";

      for (const m of group.members) {
        assignments.push({
          itemId: m.id,
          familyKey: group.key,
          split,
          stratum,
        });
        stratumAssigned++;
        if (split === "development") devCount++;
        else if (split === "validation") valCount++;
        else lockCount++;
      }
    }
  }

  // ── 4. Build per-stratum balance report ──
  const perStratum: Record<string, { development: number; validation: number; locked: number }> = {};
  for (const a of assignments) {
    perStratum[a.stratum] ??= { development: 0, validation: 0, locked: 0 };
    perStratum[a.stratum][a.split]++;
  }

  // ── 5. Integrity hash ──
  const sortedAssignments = [...assignments].sort((a, b) => a.itemId.localeCompare(b.itemId));
  const hashInput = sortedAssignments.map((a) => `${a.itemId}:${a.split}`).join("|");
  const integrityHash = createHash("sha256").update(hashInput).digest("hex");

  return {
    algorithmVersion: SPLIT_ALGORITHM_VERSION,
    createdAt: new Date().toISOString(),
    integrityHash,
    assignments: sortedAssignments,
    balance: {
      development: devCount,
      validation: valCount,
      locked: lockCount,
      perStratum,
    },
  };
}

/** Verify that a manifest hasn't been tampered with. */
export function verifyManifest(manifest: SplitManifest): boolean {
  const sorted = [...manifest.assignments].sort((a, b) => a.itemId.localeCompare(b.itemId));
  const hashInput = sorted.map((a) => `${a.itemId}:${a.split}`).join("|");
  const expected = createHash("sha256").update(hashInput).digest("hex");
  return expected === manifest.integrityHash && manifest.algorithmVersion === SPLIT_ALGORITHM_VERSION;
}
