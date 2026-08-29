"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "./NavIcon";
import { NAV_SECTIONS, isActivePath } from "@/lib/nav";

/**
 * The desktop sidebar's link list. Grouped by what the screen is for —
 * practising, tracking progress, and the evaluation surfaces — so the nav
 * reads as an application menu rather than a row of equal-weight tabs.
 */
export default function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="app-sidebar-nav nice-scroll" aria-label="Main">
      {NAV_SECTIONS.map((section) => (
        <div key={section.id} className="app-nav-group">
          <p className="app-nav-group-label" id={`nav-group-${section.id}`}>
            {section.label}
          </p>
          <ul aria-labelledby={`nav-group-${section.id}`}>
            {section.items.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`app-nav-link${active ? " active" : ""}`}
                  >
                    <NavIcon name={item.icon} className="app-nav-icon" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
