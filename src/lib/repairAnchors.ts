import type { RepairKind } from "./argumentRepair";
import type { RepairRetestAnchor } from "./repairRetest";

export interface RawRepairAnchorRow {
  id: string;
  debate_id: string;
  target_kind: RepairKind;
  created_at: unknown;
  topicId: string | null;
}

function toIso(value: unknown): string | null {
  const ms = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Collapse successful repair rows to one anchor per debate+kind (earliest
 * success wins so a later retry cannot reset the retest clock). A row whose
 * timestamp cannot be parsed is dropped: stamping it "now" would invent a
 * fresh retest clock and quietly make an old repair look brand new.
 */
export function collapseRepairAnchors(rows: RawRepairAnchorRow[]): RepairRetestAnchor[] {
  const byEpisode = new Map<string, RepairRetestAnchor>();
  for (const row of rows) {
    const attemptedAt = toIso(row.created_at);
    if (!attemptedAt) continue;
    const key = `${row.debate_id}\u0000${row.target_kind}`;
    const existing = byEpisode.get(key);
    if (!existing || Date.parse(attemptedAt) < Date.parse(existing.attemptedAt)) {
      byEpisode.set(key, {
        repairResultId: row.id,
        debateId: row.debate_id,
        targetKind: row.target_kind,
        attemptedAt,
        topicId: row.topicId,
      });
    }
  }
  return [...byEpisode.values()].sort((a, b) => Date.parse(a.attemptedAt) - Date.parse(b.attemptedAt));
}
