import Link from "next/link";
import { createClient } from "@/lib/backend/server";
import { signOut } from "@/app/login/actions";
import { pointsIntoLevel, POINTS_PER_LEVEL } from "@/lib/gamification";
import SideNav from "./SideNav";
import MobileNav from "./MobileNav";

type ContentWidth = "narrow" | "default" | "wide";

const WIDTH_CLASS: Record<ContentWidth, string> = {
  narrow: "max-w-2xl",
  default: "max-w-4xl",
  wide: "max-w-6xl",
};

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="app-brand" aria-label="Daily Debate home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={26} height={26} className="rounded-lg" aria-hidden="true" />
      <span className="app-brand-copy">
        <span className="app-brand-name">Daily Debate</span>
        {!compact && <span className="app-brand-tag">Think in public</span>}
      </span>
    </Link>
  );
}

function LevelChip({
  level,
  points,
  streak,
  compact = false,
}: {
  level: number;
  points: number;
  streak: number;
  compact?: boolean;
}) {
  const title = `${pointsIntoLevel(points)}/${POINTS_PER_LEVEL} points into level ${level}`;
  if (compact) {
    return (
      <span className="pill tabular" title={title}>
        L{level} · 🔥{streak}
      </span>
    );
  }
  return (
    <div className="app-level" title={title}>
      <div className="app-level-top">
        <span className="tabular font-semibold">Level {level}</span>
        <span className="tabular text-ink3">🔥 {streak}</span>
      </div>
      <div className="app-level-track">
        <div
          className="app-level-fill bar-anim"
          style={{ width: `${Math.round((pointsIntoLevel(points) / POINTS_PER_LEVEL) * 100)}%` }}
        />
      </div>
      <p className="app-level-meta tabular">
        {pointsIntoLevel(points)} / {POINTS_PER_LEVEL} to level {level + 1} · {points} total
      </p>
    </div>
  );
}

/**
 * The application frame every signed-in screen renders inside: a persistent
 * sidebar on desktop, a compact bar plus bottom tabs on mobile, and one
 * content column whose width is chosen per screen rather than per page.
 *
 * Signed-out visitors get the same frame without navigation, so auth-gated
 * pages still look like part of the product instead of a bare error page.
 */
export default async function AppShell({
  children,
  width = "default",
}: {
  children: React.ReactNode;
  width?: ContentWidth;
}) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  const { data: profile } = user
    ? await db
        .from("profiles")
        .select("total_points, level, current_streak")
        .eq("id", user.id)
        .single()
    : { data: null };

  const contentClass = `app-content ${WIDTH_CLASS[width]}`;

  if (!user) {
    return (
      <div className="app-shell app-shell-guest">
        <div className="app-main">
          <header className="app-topbar app-topbar-guest">
            <Brand compact />
            <Link href="/login" className="btn btn-secondary px-3 py-1.5 text-xs">
              Sign in
            </Link>
          </header>
          <main id="main" className={contentClass}>
            {children}
          </main>
        </div>
      </div>
    );
  }

  const signOutButton = (
    <form action={signOut}>
      <button type="submit" className="btn btn-ghost w-full justify-start px-3 py-2 text-xs">
        Sign out
      </button>
    </form>
  );

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside className="app-sidebar" aria-label="Sidebar">
        <div className="app-sidebar-head">
          <Brand />
        </div>
        <SideNav />
        <div className="app-sidebar-foot">
          {profile && (
            <LevelChip
              level={profile.level}
              points={profile.total_points}
              streak={profile.current_streak}
            />
          )}
          {signOutButton}
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <Brand compact />
          {profile && (
            <LevelChip
              level={profile.level}
              points={profile.total_points}
              streak={profile.current_streak}
              compact
            />
          )}
        </header>

        <main id="main" className={contentClass}>
          {children}
        </main>

        <MobileNav
          sheetFooter={
            <>
              {profile && (
                <LevelChip
                  level={profile.level}
                  points={profile.total_points}
                  streak={profile.current_streak}
                />
              )}
              {signOutButton}
            </>
          }
        />
      </div>
    </div>
  );
}
