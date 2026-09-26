import { NextResponse } from "next/server";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { getCurrentUser } from "@/lib/currentViewer";

// The signed-in user's own skill ledger: per-metric trajectories across
// their completed debates, improvements/regressions, and the fixed
// deterministic benchmark-opponent comparison.

export async function GET() {
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
