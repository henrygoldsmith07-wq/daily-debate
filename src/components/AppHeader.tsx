import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { pointsIntoLevel, POINTS_PER_LEVEL } from "@/lib/gamification";

export default async function AppHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--rule)] bg-[var(--panel)] px-4 py-3 sm:px-6">
      <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <img src="/logo.svg" alt="" width={22} height={22} className="rounded-md" aria-hidden="true" />
        Daily Debate
      </Link>
      <nav className="flex items-center gap-3 text-sm text-ink3 sm:gap-4" aria-label="Main">
        <Link href="/" className="hover:text-[var(--foreground)]">
          Today
        </Link>
        <Link href="/pvp" className="hover:text-[var(--foreground)]">
          PvP
        </Link>
        <Link href="/leaderboard" className="hover:text-[var(--foreground)]">
          Leaderboard
        </Link>
        <Link href="/benchmark" className="hover:text-[var(--foreground)]">
          Benchmark
        </Link>
      </nav>
      <div className="flex items-center gap-3 text-sm sm:gap-4">
        {profile && (
          <span
            className="chip-elevated tabular hidden rounded-full px-3 py-1 text-ink3 sm:inline"
            title={`${pointsIntoLevel(profile.total_points)}/${POINTS_PER_LEVEL} pts into level ${profile.level}`}
          >
            Lvl {profile.level} · {profile.total_points} pts · 🔥 {profile.current_streak}
          </span>
        )}
        {profile && (
          <span
            className="chip-elevated tabular rounded-full px-2.5 py-1 text-xs text-ink3 sm:hidden"
            title={`${pointsIntoLevel(profile.total_points)}/${POINTS_PER_LEVEL} pts into level ${profile.level}`}
          >
            L{profile.level} · 🔥{profile.current_streak}
          </span>
        )}
        <form action={signOut}>
          <button type="submit" className="btn btn-ghost px-3 py-1 text-xs">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
