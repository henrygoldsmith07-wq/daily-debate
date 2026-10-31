import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { REPORT_REASONS, isDebateId, reportDebate, type ExploreKind, type ReportReason } from "@/lib/explore";

// Report a published debate (migration 043). One report per reader per
// debate; three from distinct accounts take it off Explore. The database
// function is the only writer and refuses unpublished debates and a
// participant reporting their own.
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "explore-report", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to report a debate." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { kind?: unknown; id?: unknown; reason?: unknown } | null;
  const kind = body?.kind === "solo" || body?.kind === "pvp" ? (body.kind as ExploreKind) : null;
  const id = isDebateId(body?.id) ? body.id : null;
  const reason = (REPORT_REASONS as readonly unknown[]).includes(body?.reason) ? (body?.reason as ReportReason) : null;
  if (!kind || !id || !reason) return NextResponse.json({ error: "Choose a reason for the report." }, { status: 400 });

  try {
    const outcome = await reportDebate(user.id, kind, id, reason);
    if (outcome === "not_public") return NextResponse.json({ error: "This debate is not published." }, { status: 404 });
    if (outcome === "own_debate") {
      return NextResponse.json({ error: "This is your debate. Take it down from its result page instead." }, { status: 403 });
    }
    return NextResponse.json({ outcome });
  } catch (error) {
    console.error("explore report failed:", error);
    return NextResponse.json({ error: "Could not send your report. Try again." }, { status: 503 });
  }
}
