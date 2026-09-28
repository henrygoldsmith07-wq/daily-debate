export const SKILL_LEDGER_DEBATE_LIMIT = 100;

export interface LedgerSourceWindow {
  limit: number;
  completedDebatesLoaded: number;
  totalCompletedDebates: number | null;
  truncated: boolean | null;
}

export function resolveLedgerSourceWindow(
  completedDebatesLoaded: number,
  exactTotal: number | null,
): LedgerSourceWindow {
  const totalCompletedDebates =
    exactTotal === null && completedDebatesLoaded < SKILL_LEDGER_DEBATE_LIMIT
      ? completedDebatesLoaded
      : exactTotal;
  const truncated =
    totalCompletedDebates === null
      ? null
      : totalCompletedDebates > completedDebatesLoaded;

  return {
    limit: SKILL_LEDGER_DEBATE_LIMIT,
    completedDebatesLoaded,
    totalCompletedDebates,
    truncated,
  };
}
