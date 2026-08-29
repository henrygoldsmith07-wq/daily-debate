/**
 * Single source of truth for application navigation.
 *
 * The shell renders the same items three ways — desktop sidebar, mobile tab
 * bar, and the mobile "More" sheet — so the destinations only get declared
 * once here. `primary` marks the handful of screens that earn a tab slot on
 * small screens; everything else lives behind More.
 */

export type NavIconName =
  | "today"
  | "pvp"
  | "progress"
  | "dna"
  | "history"
  | "leaderboard"
  | "rate"
  | "benchmark"
  | "metrics";

export interface NavItem {
  href: string;
  label: string;
  /** Short one-liner shown in the More sheet, where there is room for it. */
  description: string;
  icon: NavIconName;
  /** Gets its own slot in the mobile tab bar. */
  primary?: boolean;
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
        primary: true,
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
        description: "Every debate you have finished",
        icon: "history",
        primary: true,
      },
      {
        href: "/leaderboard",
        label: "Leaderboard",
        description: "Where you land against other debaters",
        icon: "leaderboard",
      },
    ],
  },
  {
    id: "evaluation",
    label: "Evaluation",
    items: [
      {
        href: "/rate",
        label: "Rate debates",
        description: "Blind-rate debates for the human corpus",
        icon: "rate",
      },
      {
        href: "/benchmark",
        label: "Judge benchmark",
        description: "How the judges are validated",
        icon: "benchmark",
      },
      {
        href: "/metrics",
        label: "Corpus metrics",
        description: "Published evaluation numbers",
        icon: "metrics",
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export const PRIMARY_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter((item) => item.primary);

/**
 * True when `href` is the section the current path belongs to. "/" only ever
 * matches itself so the dashboard tab does not stay lit on every screen.
 */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav entry a path belongs to, including routes that are not in the nav. */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isActivePath(pathname, item.href));
}
