import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";
import type { PvpVerdict } from "@/lib/types";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function HistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main id="main" className="mx-auto w-full max-w-2xl px-4 py-10 text-sm text-ink3">
          Sign in to see your debate history.
        </main>
      </div>
    );
  }

  const [soloRes, pvpRes] = await Promise.all([
    supabase
      .from("solo_debates")
      .select("id, status, side, round_count, total_score, created_at, completed_at, topic_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("pvp_matches")
      .select("id, status, player_a, player_b, winner_id, judge_verdict, completed_at, topic_id")
      .or(`player_a.eq.${user.id},player_b.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const soloDebates = soloRes.data ?? [];
  const pvpMatches = pvpRes.data ?? [];
  const topicIds = [...new Set([...soloDebates, ...pvpMatches].map((row) => row.topic_id))];
  const topicTitles = new Map<string, string>();
  if (topicIds.length) {
    const { data: topics } = await supabase.from("daily_topics").select("id, title").in("id", topicIds);
    for (const t of topics ?? []) topicTitles.set(t.id, t.title);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Your debates</h1>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-wide text-ink3">Solo</h2>
          {soloDebates.length === 0 ? (
            <p className="text-sm text-ink3">No solo debates yet.</p>
          ) : (
            soloDebates.map((d) => (
              <Link
                key={d.id}
                href={`/debate/${d.id}`}
                className="surface-card flex items-center justify-between gap-3 px-4 py-3 text-sm hover:border-[var(--accent)]"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{topicTitles.get(d.topic_id) ?? "Daily topic"}</span>
                  <span className="text-xs text-ink3">
                    {formatDate(d.completed_at ?? d.created_at)} · arguing {d.side} · {d.round_count} rounds
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {d.status === "completed" ? (
                    <span className="tabular font-medium">{d.total_score ?? 0} pts</span>
                  ) : (
                    <span className="text-xs text-[var(--accent)]">resume →</span>
                  )}
                </span>
              </Link>
            ))
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-wide text-ink3">Player vs player</h2>
          {pvpMatches.length === 0 ? (
            <p className="text-sm text-ink3">No PvP matches yet.</p>
          ) : (
            pvpMatches.map((m) => {
              const verdict = m.judge_verdict as PvpVerdict | null;
              const outcome =
                m.status !== "completed"
                  ? "in progress"
                  : !verdict || verdict.scoreStatus === "insufficient_evidence"
                    ? "no confident verdict"
                    : m.winner_id === null
                      ? "too close to call"
                      : m.winner_id === user.id
                        ? "won"
                        : "lost";
              return (
                <Link
                  key={m.id}
                  href={`/pvp/${m.id}`}
                  className="surface-card flex items-center justify-between gap-3 px-4 py-3 text-sm hover:border-[var(--accent)]"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{topicTitles.get(m.topic_id) ?? "Daily topic"}</span>
                    <span className="text-xs text-ink3">{formatDate(m.completed_at)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`tabular font-medium ${
                        outcome === "won" ? "text-[var(--accent)]" : outcome === "lost" ? "text-[var(--bad)]" : ""
                      }`}
                    >
                      {outcome}
                    </span>
                    {verdict && verdict.scoreStatus !== "insufficient_evidence" && m.winner_id !== null && (
                      <span className="block text-xs text-ink3 tabular">
                        {verdict.playerAScore}–{verdict.playerBScore}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}
