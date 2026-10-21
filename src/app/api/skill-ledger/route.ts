import { NextResponse } from "next/server";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { getCurrentUser } from "@/lib/currentViewer";
import { checkRateLimit } from "@/lib/rateLimit";

// The signed-in user's own skill ledger: per-metric trajectories across
// their completed debates, improvements/regressions, and the fixed
// deterministic benchmark-opponent comparison.

export async function GET(request: Request) {
  // The ledger aggregates every completed debate and runs a benchmark
  // comparison, so it is bounded like the other authenticated reads.
  const limited = await checkRateLimit(request, { name: "skill-ledger", limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const ledger = await buildLedgerForUser(user.id);
    return NextResponse.json(ledger, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Skill ledger is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
