import type { PoolClient } from "pg";

export interface CandidateRow {
  id: string;
  status: string;
  stored: number | string;
  actual: number;
}

export interface RepairResult {
  id: string;
  skipped?: string;
  before?: { status: string; stored: number };
  actual?: number;
  after?: { stored: number; status: string };
  changed: boolean;
  wouldChange?: boolean;
}

export declare function findCandidates(
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
  minRaters: number,
): Promise<CandidateRow[]>;

export declare function repairItemWithLock(
  client: PoolClient,
  itemId: string,
  minRaters: number,
  options?: {
    apply?: boolean;
    onLockedAfterCount?: ((client: PoolClient, info: { itemId: string; actual: number }) => Promise<void>) | null;
  },
): Promise<RepairResult>;
