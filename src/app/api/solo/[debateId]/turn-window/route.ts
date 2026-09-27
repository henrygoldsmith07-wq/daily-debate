import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { isDebateModeId, resolveMode } from "@/lib/debateModes";

export async function POST(request: Request, { params }: { params: Promise<{ debateId: string }> }) {
  const limited = await checkRateLimit(request, { name: "solo-turn-window", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { debateId } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const turnId = typeof body?.turnId === "string" ? body.turnId : "";
  const modeId = isDebateModeId(body?.modeId) ? body.modeId : null;
  if (!turnId || !modeId) {
    return NextResponse.json({ error: "turnId and a valid modeId are required." }, { status: 400 });
  }

  const mode = resolveMode(modeId);
  const { data, error } = await db.rpc("start_solo_turn_window", {
    p_debate_id: debateId,
    p_user_id: user.id,
    p_turn_id: turnId,
    p_mode: modeId,
    p_limit_seconds: mode.hardTimeLimitSecs,
  });

  if (error) {
    console.error("Failed to start solo response window:", error);
    return NextResponse.json({ error: "Failed to start the response timer." }, { status: 500 });
  }
  if (!data || typeof data !== "object") {
    return NextResponse.json({ error: "This round is no longer available." }, { status: 409 });
  }

  // remainingSeconds is computed inside PostgreSQL from the same clock that
  // created the window. Do not recompute it with the application-server clock.
  const payload = data as {
    modeId?: string;
    startedAt?: string | null;
    expiresAt?: string | null;
    remainingSeconds?: number | null;
    expired?: boolean;
  };

  return NextResponse.json(payload);
}
