"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/pvp", label: "PvP" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/history", label: "History" },
  { href: "/progress", label: "Progress" },
  { href: "/rate", label: "Rate" },
  { href: "/benchmark", label: "Benchmark" },
];

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-3 text-sm text-ink3 sm:gap-4" aria-label="Main">
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`transition-colors hover:text-[var(--foreground)] ${
              active ? "font-medium text-[var(--foreground)]" : ""
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
