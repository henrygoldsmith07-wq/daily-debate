import Link from "next/link";
import { createClient } from "@/lib/backend/server";
import AppShell from "@/components/AppShell";
import SignedOut from "@/components/SignedOut";
import PageHeader from "@/components/PageHeader";
import type { PvpVerdict } from "@/lib/types";
import { normalizeIanaTimeZone } from "@/lib/timeZone";

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 50;

function formatDate(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

export default async function HistoryPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return (
      <AppShell width="narrow">
        <SignedOut
          title="Sign in to see your debate history"
          description="Your finished debates, scores and PvP results are kept with your account."
        />
      </AppShell>
    );
  }

  const [soloRes, pvpRes, profileRes] = await Promise.all([
    db
      .from("solo_debates")
      .select("id, status, side, round_count, total_score, performance_score, bonus_xp, created_at, completed_at, topic_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    db
      .from("pvp_matches")
      .select("id, status, player_a, player_b, winner_id, judge_verdict, completed_at, topic_id")
      .or(`player_a.eq.${user.id},player_b.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    db.from("profiles").select("timezone").eq("id", user.id).single(),
  ]);

  const timeZone = normalizeIanaTimeZone(profileRes.data?.timezone);
  const soloDebates = soloRes.data ?? [];
  const pvpMatches = pvpRes.data ?? [];
  // A failed read must not look like an empty history. Previously a DB error
  // produced `[]`, which rendered the same "No solo debates yet" empty state as
  // a genuine first visit — indistinguishable data loss.
  const loadError = soloRes.error ?? pvpRes.error ?? profileRes.error ?? null;
  const topicIds = [...new Set([...soloDebates, ...pvpMatches].map((row) => row.topic_id))];
  const topicTitles = new Map<string, string>();
  if (topicIds.length) {
    const { data: topics } = await db.from("daily_topics").select("id, title").in("id", topicIds);
    for (const t of topics ?? []) topicTitles.set(t.id, t.title);
  }

  if (loadError) {
    return (
      <AppShell width="narrow">
        <PageHeader eyebrow="Your practice" title="History" description="Your solo and PvP debate records" />
        <div className="surface-card p-5" role="alert">
          <p className="text-sm font-semibold text-[var(--bad)]">History could not be loaded</p>
          <p className="mt-1 text-sm text-ink3">
            Your debates are safe — this is a temporary read problem. Reload to try again.
          </p>
          <Link href="/history" className="btn btn-ghost mt-3 px-3 py-1.5 text-xs">
            Reload history
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Your record"
        title="Your debates"
        description={`Latest debates, newest first. Up to ${HISTORY_LIMIT} solo and ${HISTORY_LIMIT} PvP records are shown.`}
        actions={
          <>
            <span className="pill tabular">{soloDebates.length} solo shown</span>
            <span className="pill tabular">{pvpMatches.length} PvP shown</span>
          </>
        }
      />

      <section className="flex flex-col gap-3">
        <div className="section-heading">
          <h2>Solo</h2>
          <span className="section-heading-note">Against the AI opponent</span>
        </div>
        {soloDebates.length === 0 ? (
          /* Matches the app's own SignedOut standard: a card with a reason and
             a next action, not a bare sentence. A dead end here is the difference
             between a first-time user finding the debate button and leaving. */
          <div className="surface-card flex flex-col items-start gap-2 p-5">
            <p className="font-semibold">Your first solo debate is waiting</p>
            <p className="text-sm text-ink3">
              Finish a debate and it appears here with its performance, XP and the weakness worth repairing.
            </p>
            <Link href="/" className="btn btn-primary mt-1 px-4 py-2 text-sm">
              Start today&apos;s debate
            </Link>
          </div>
        ) : (
          soloDebates.map((d) => {
            const performance = d.performance_score;
            const xp = (d.total_score ?? 0) + (d.bonus_xp ?? 0);
            return (
            <Link
              key={d.id}
              href={`/debate/${d.id}`}
              className="surface-card flex items-center justify-between gap-3 px-4 py-3 text-sm hover:border-[var(--accent)]"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{topicTitles.get(d.topic_id) ?? "Daily topic"}</span>
                <span className="text-xs text-ink3">
                  {formatDate(d.completed_at ?? d.created_at, timeZone)} · arguing {d.side} · {d.round_count} rounds
                </span>
              </span>
              <span className="shrink-0 text-right">
                {d.status === "completed" ? (
                  <>
                    <span className="block tabular font-medium">
                      {performance === null ? "Performance unavailable" : `${performance}/100 performance`}
                    </span>
                    <span className="block text-xs text-ink3">+{xp} XP</span>
                  </>
                ) : (
                  <span className="text-xs text-[var(--accent)]">resume →</span>
                )}
              </span>
            </Link>
            );
          })
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="section-heading">
          <h2>Player vs player</h2>
          <span className="section-heading-note">Judged head-to-head</span>
        </div>
        {pvpMatches.length === 0 ? (
          <div className="surface-card flex flex-col items-start gap-2 p-5">
            <p className="font-semibold">No player-vs-player matches yet</p>
            <p className="text-sm text-ink3">
              Challenge a friend to argue today&apos;s motion, or join the queue when PvP is open.
            </p>
            <Link href="/" className="btn btn-ghost mt-1 px-4 py-2 text-sm">
              Back to today
            </Link>
          </div>
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
                  <span className="text-xs text-ink3">{formatDate(m.completed_at, timeZone)}</span>
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
    </AppShell>
  );
}
