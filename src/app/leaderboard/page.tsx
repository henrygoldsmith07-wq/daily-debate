import { createClient } from "@/lib/backend/server";
import { getFactorRatings } from "@/lib/ratings";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import RatingBreakdown from "@/components/RatingBreakdown";
import { getCurrentUser, getProfileSummary } from "@/lib/currentViewer";

export default async function LeaderboardPage() {
  const db = await createClient();
  const user = await getCurrentUser();

  const { data: profiles } = await db
    .from("profiles")
    .select("id, username, total_points, level, current_streak")
    .order("total_points", { ascending: false })
    .limit(50);

  const ratings = user ? await getFactorRatings(db, user.id) : null;
  const list = profiles ?? [];

  // Absolute rank for the signed-in player, even when they sit outside the
  // top 50 shown in the table.
  let yourRank: number | null = null;
  if (user) {
    const mine = await getProfileSummary(user.id);
    if (mine) {
      const { count } = await db
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gt("total_points", mine.total_points);
      yourRank = (count ?? 0) + 1;
    }
  }

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Practice activity"
        title="Points leaderboard"
        description="Ordered by total training points earned across solo debates and PvP matches. Points reflect participation and practice activity, not validated debating ability."
        actions={yourRank !== null && <span className="pill tabular">Points position #{yourRank}</span>}
      />
      {ratings && <RatingBreakdown ratings={ratings} />}
      <div className="surface-card overflow-hidden">
        {list.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink3">
            No players yet. Finish a debate to appear here.
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Global practice leaderboard ordered by total training points</caption>
            <thead>
              <tr className="border-b border-[var(--rule)] text-left text-xs uppercase tracking-wide text-ink3">
                <th scope="col" className="px-4 py-3">#</th>
                <th scope="col" className="px-4 py-3">Player</th>
                <th scope="col" className="px-4 py-3">Level</th>
                <th scope="col" className="px-4 py-3">Streak</th>
                <th scope="col" className="px-4 py-3 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {list.map((profile, index) => {
                const isYou = profile.id === user?.id;
                return (
                  <tr
                    key={profile.id}
                    className={`tabular border-b border-[var(--rule)] last:border-0 ${
                      isYou ? "bg-[var(--accent-soft)]" : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-ink3">{index + 1}</td>
                    <td className="px-4 py-3">
                      {profile.username ?? "Anonymous"}
                      {isYou && (
                        <span className="ml-2 text-xs text-[var(--accent)]">you</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{profile.level}</td>
                    <td className="px-4 py-3">🔥 {profile.current_streak}</td>
                    <td className="px-4 py-3 text-right font-medium">{profile.total_points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
