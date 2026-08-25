import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";

// The signed-in user's own skill ledger: per-metric trajectories across
// their completed debates, improvements/regressions, and the fixed
// deterministic benchmark-opponent comparison.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ledger = await buildLedgerForUser(user.id);
  return NextResponse.json(ledger, { headers: { "Cache-Control": "no-store" } });
}
