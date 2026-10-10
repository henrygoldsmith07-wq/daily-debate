/**
 * Single source of truth for application navigation.
 *
 * The shell renders the same items three ways — desktop sidebar, mobile tab
 * bar, and the mobile "More" sheet — so the destinations only get declared
 * once here. `primary` marks the handful of screens that earn a tab slot on
 * small screens; everything else lives behind More.
 *
 * `experimental: true` marks a surface the roadmap parks until the daily loop
 * has real weekly users. Those items stay declared here (the code and tests
 * behind them are kept) but `visibleNavSections()` filters them out unless
 * `NEXT_PUBLIC_EXPERIMENTAL_SURFACES=1` — production navigation stays
 * focused on the daily solo loop.
 */

import { experimentalSurfacesEnabled } from "./featureFlags";

export type NavIconName =
  | "today"
  | "pvp"
  | "progress"
  | "dna"
  | "history"
  | "leaderboard"
  | "rate"
  | "benchmark"
  | "metrics"
  | "research";

export interface NavItem {
  href: string;
  label: string;
  /** Short one-liner shown in the More sheet, where there is room for it. */
  description: string;
  icon: NavIconName;
  /** Gets its own slot in the mobile tab bar. */
  primary?: boolean;
  /** Hidden from navigation unless experimental surfaces are enabled. */
  experimental?: boolean;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "practice",
    label: "Practice",
    items: [
      {
        href: "/",
        label: "Today",
        description: "Today's motion and your next rep",
        icon: "today",
        primary: true,
      },
      {
        href: "/pvp",
        label: "Player vs Player",
        description: "Debate another player on today's motion",
        icon: "pvp",
        experimental: true,
      },
    ],
  },
  {
    id: "progress",
    label: "Progress",
    items: [
      {
        href: "/progress",
        label: "Progress",
        description: "Skill trajectory and your coaching plan",
        icon: "progress",
        primary: true,
      },
      {
        href: "/dna",
        label: "Argument DNA",
        description: "How your reasoning habits change over time",
        icon: "dna",
      },
      {
        href: "/history",
        label: "History",
        description: "Your latest solo and PvP debate records",
        icon: "history",
        primary: true,
      },
      {
        href: "/leaderboard",
        label: "Leaderboard",
        description: "Practice activity and points across players",
        icon: "leaderboard",
      },
    ],
  },
  {
    id: "research",
    label: "Research",
    items: [
      {
        href: "/research",
        label: "Trust & research",
        description: "Evidence classes, judge validation, corpus metrics, and rating debates",
        icon: "research",
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export const PRIMARY_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter((item) => item.primary);

/**
 * The nav sections for the current environment: the full declaration, minus
 * experimental items unless `NEXT_PUBLIC_EXPERIMENTAL_SURFACES=1`. Sections
 * left empty by the filter are dropped so no orphaned group label renders.
 */
export function visibleNavSections(): NavSection[] {
  if (experimentalSurfacesEnabled()) return NAV_SECTIONS;
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.experimental),
  })).filter((section) => section.items.length > 0);
}

/** Every visible nav entry, flattened (mirrors `NAV_ITEMS`). */
export function visibleNavItems(): NavItem[] {
  return visibleNavSections().flatMap((section) => section.items);
}

/** The visible items that earn a mobile tab slot (mirrors `PRIMARY_NAV_ITEMS`). */
export function visiblePrimaryNavItems(): NavItem[] {
  return visibleNavItems().filter((item) => item.primary);
}

/**
 * True when `href` is the section the current path belongs to. "/" only ever
 * matches itself so the dashboard tab does not stay lit on every screen.
 */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Routes that carry no nav entry of their own but still belong to a section.
 *
 * `/debate/<id>` is reached from and returns to Today's motion, and
 * `/challenge/<code>` exists to put someone into a match on that motion. Without
 * this map, both screens left the navigation with nothing selected — the
 * sidebar and the tab bar went visually dead on the screen users spend the most
 * time on, and a screen-reader user lost the only "where am I" signal.
 */
const ROUTE_OWNER_HREF: Record<string, string> = {
  debate: "/",
  challenge: "/",
};

/**
 * The nav entry a path belongs to, including routes that are not in the nav.
 * Prefers an exact/ancestor nav match; otherwise falls back to the owning
 * section above. Returns undefined only for screens that genuinely belong to no
 * section (auth, admin, legal).
 */
export function activeNavItem(pathname: string): NavItem | undefined {
  const direct = NAV_ITEMS.find((item) => isActivePath(pathname, item.href));
  if (direct) return direct;
  for (const [prefix, href] of Object.entries(ROUTE_OWNER_HREF)) {
    if (pathname === `/${prefix}` || pathname.startsWith(`/${prefix}/`)) {
      return NAV_ITEMS.find((item) => item.href === href);
    }
  }
  return undefined;
}
