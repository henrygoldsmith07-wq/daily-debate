import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { isCorpusAdmin } from "@/lib/corpus";
import { loadFunnelData } from "@/lib/productFunnelServer";
import { buildFunnelReport, buildRepairOutcomeFunnel, FUNNEL_DEFAULT_WINDOW_DAYS } from "@/lib/productFunnel";
import { buildRepairEffectiveness } from "@/lib/repairEffectiveness";

/**
 * Internal admin report: product funnel + repair effectiveness, computed from
 * the existing privacy-conscious event/repair tables. Gated by
 * CORPUS_ADMIN_EMAILS like every other admin surface.
 */
export async function GET(request: Request) {
  const limited = await checkRateLimit(request, { name: "funnel-report", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || !isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const windowDaysParam = Number(new URL(request.url).searchParams.get("windowDays"));
  const windowDays = Number.isFinite(windowDaysParam) && windowDaysParam >= 7 && windowDaysParam <= 365
    ? Math.floor(windowDaysParam)
    : FUNNEL_DEFAULT_WINDOW_DAYS;

  const { events, repairs, debateWeaknesses, completeness } = await loadFunnelData();
  const funnel = buildFunnelReport(events, { windowDays });
  const repairEffectiveness = buildRepairEffectiveness(repairs, debateWeaknesses, { windowDays });
  const trainingLoop = buildRepairOutcomeFunnel(repairs, debateWeaknesses, events, {});

  return NextResponse.json({ funnel, repairEffectiveness, trainingLoop, completeness });
}
