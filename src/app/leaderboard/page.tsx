import { createClient } from "@/lib/supabase/server";
import { getFactorRatings } from "@/lib/ratings";
import AppHeader from "@/components/AppHeader";
import RatingBreakdown from "@/components/RatingBreakdown";

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .order("total_points", { ascending: false })
    .limit(50);

  const ratings = user ? await getFactorRatings(supabase, user.id) : null;
  const list = profiles ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
        {ratings && <RatingBreakdown ratings={ratings} />}
        <div className="surface-card overflow-hidden">
          {list.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink3">
              No players yet. Finish a debate to appear here.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--rule)] text-left text-xs uppercase tracking-wide text-ink3">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Player</th>
                  <th className="px-4 py-3">Level</th>
                  <th className="px-4 py-3">Streak</th>
                  <th className="px-4 py-3 text-right">Points</th>
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
      </main>
    </div>
  );
}
