import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { isCorpusAdmin } from "@/lib/corpus";

// Admin-only CSV export of the human-rating corpus: ratings and items,
// bounded and anonymised exactly like the rater view (no contributor ids).
// Output is for analysis; it is not a modification path — ratings stay
// append-once and corrections stay on the admin correction route.

const LIMITS = { ratings: 5000, items: 2000 };

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

export async function GET() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createServiceClient();
  const [{ data: ratings }, { data: items }] = await Promise.all([
    service
      .from("corpus_ratings")
      .select("corpus_id, rater_id, winner, confidence, scores_a, scores_b, presented_first, created_at")
      .order("created_at", { ascending: true })
      .limit(LIMITS.ratings),
    service
      .from("corpus_items")
      .select("id, topic, status, length_bucket, ability_band, dynamics_tier, subject_category, rating_count")
      .order("created_at", { ascending: true })
      .limit(LIMITS.items),
  ]);

  const lines: string[] = [];
  lines.push("# corpus_ratings (append-once; corrections live on the admin correction route)");
  lines.push(csvRow(["corpus_id", "rater_id", "winner", "confidence", "scores_a", "scores_b", "presented_first", "created_at"]));
  for (const r of (ratings ?? []) as Array<Record<string, unknown>>) {
    lines.push(
      csvRow([
        r.corpus_id,
        r.rater_id,
        r.winner,
        r.confidence,
        JSON.stringify(r.scores_a ?? {}),
        JSON.stringify(r.scores_b ?? {}),
        r.presented_first ?? "a",
        r.created_at,
      ]),
    );
  }
  if ((ratings ?? []).length >= LIMITS.ratings) {
    lines.push(`# note: ratings export truncated at ${LIMITS.ratings} rows`);
  }

  lines.push("");
  lines.push("# corpus_items (no contributor ids — anonymised like the rater view)");
  lines.push(csvRow(["id", "topic", "status", "length_bucket", "ability_band", "dynamics_tier", "subject_category", "rating_count"]));
  for (const i of (items ?? []) as Array<Record<string, unknown>>) {
    lines.push(
      csvRow([
        i.id,
        i.topic,
        i.status,
        i.length_bucket,
        i.ability_band,
        i.dynamics_tier,
        i.subject_category,
        i.rating_count ?? 0,
      ]),
    );
  }
  if ((items ?? []).length >= LIMITS.items) {
    lines.push(`# note: items export truncated at ${LIMITS.items} rows`);
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="corpus-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
