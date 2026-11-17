import { NextResponse } from "next/server";
import { createClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getTodayTopic } from "@/lib/dailyTopic";

export async function GET(request: Request) {
  // A fresh-day request may write the curated fallback topic to the store;
  // getTodayTopic() makes no AI call at request time. Rate-limit this path like
  // every other route.
  const limited = await checkRateLimit(request, { name: "daily-topic", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const topic = await getTodayTopic();
    return NextResponse.json({ topic });
  } catch (error) {
    console.error("Failed to load daily topic:", error);
    return NextResponse.json({ error: "Failed to load today's topic." }, { status: 500 });
  }
}
