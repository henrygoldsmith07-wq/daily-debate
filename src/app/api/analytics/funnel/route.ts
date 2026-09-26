import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { loadFunnelData } from "@/lib/productFunnelServer";
import { buildFunnelReport, buildRepairOutcomeFunnel, FUNNEL_DEFAULT_WINDOW_DAYS } from "@/lib/productFunnel";
import { buildRepairEffectiveness } from "@/lib/repairEffectiveness";
import { getRequestAuthContext } from "@/lib/requestAuth";

/**
 * Internal admin report: product funnel + repair effectiveness, computed from
 * the existing privacy-conscious event/repair tables. Gated by
 * CORPUS_ADMIN_EMAILS like every other admin surface.
 */
export async function GET(request: Request) {
  const limited = await checkRateLimit(request, { name: "funnel-report", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await getRequestAuthContext();
  if (!auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const windowDaysParam = Number(new URL(request.url).searchParams.get("windowDays"));
  const windowDays = Number.isFinite(windowDaysParam) && windowDaysParam >= 7 && windowDaysParam <= 365
    ? Math.floor(windowDaysParam)
    : FUNNEL_DEFAULT_WINDOW_DAYS;

  const funnelData = await loadFunnelData();
  if (funnelData.status === "unavailable") {
    return NextResponse.json(
      {
        status: "unavailable",
        errorCategory: funnelData.errorCategory,
        completeness: funnelData.completeness,
      },
      { status: 503 },
    );
  }
  const { events, repairs, retests, debateWeaknesses, completeness } = funnelData;
  const funnel = buildFunnelReport(events, { windowDays });
  const repairEffectiveness = buildRepairEffectiveness(repairs, debateWeaknesses, { windowDays, retests });
  const trainingLoop = buildRepairOutcomeFunnel(repairs, debateWeaknesses, events, { retests });

  return NextResponse.json({
    status: funnelData.status,
    errorCategory: funnelData.errorCategory,
    funnel,
    repairEffectiveness,
    trainingLoop,
    completeness,
  });
}
