import type { NavIconName } from "@/lib/nav";

/**
 * Line icons for the shell navigation. They are drawn on a 24×24 grid with a
 * single stroke weight so the sidebar and tab bar read as one set, and they
 * inherit `currentColor` so the active/inactive states need no icon variants.
 */
const PATHS: Record<NavIconName, React.ReactNode> = {
  today: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M9 15.5l2 2 4-4" />
    </>
  ),
  pvp: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H7l-4 3z" />
      <path d="M21 12a2 2 0 0 0-2-2h-2.5" />
      <path d="M21 12v3a2 2 0 0 1-2 2h-3l-3 3v-3a2 2 0 0 1 0-.2" />
    </>
  ),
  progress: (
    <>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M7.5 15.5l3.5-4 3 2.5 4.5-6" />
    </>
  ),
  dna: (
    <>
      <path d="M7 3c0 4.5 10 6 10 10.5S7 19.5 7 21" />
      <path d="M17 3c0 4.5-10 6-10 10.5S17 19.5 17 21" />
      <path d="M8.5 7h7M8 16h8" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 9A9 9 0 1 1 3 12" />
      <path d="M3 4v5h5" />
      <path d="M12 8v4.5l3 1.8" />
    </>
  ),
  leaderboard: (
    <>
      <path d="M4 20h16" />
      <rect x="4.5" y="12" width="4.5" height="8" rx="1" />
      <rect x="9.75" y="7" width="4.5" height="13" rx="1" />
      <rect x="15" y="14.5" width="4.5" height="5.5" rx="1" />
    </>
  ),
  rate: (
    <path d="M12 4.5l2.3 4.9 5.2.7-3.8 3.7.9 5.3-4.6-2.6-4.6 2.6.9-5.3L4.5 10l5.2-.7z" />
  ),
  benchmark: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5" />
    </>
  ),
  metrics: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M8 15.5v-3M12 15.5v-6M16 15.5v-4.5" />
    </>
  ),
};

export default function NavIcon({
  name,
  className = "",
}: {
  name: NavIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
