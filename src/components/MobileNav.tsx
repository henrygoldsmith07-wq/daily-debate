"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import NavIcon from "./NavIcon";
import { NAV_SECTIONS, PRIMARY_NAV_ITEMS, isActivePath } from "@/lib/nav";

/**
 * Small-screen navigation: a fixed bottom tab bar for the screens people open
 * daily, plus a sheet holding everything else. The sheet closes on navigation,
 * on Escape, and on a backdrop tap, and body scroll is locked while it is up.
 */
export default function MobileNav({ sheetFooter }: { sheetFooter?: React.ReactNode }) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetPath, setSheetPath] = useState(pathname);

  // Close the sheet whenever the route changes — otherwise it stays open over
  // the page the user just navigated to. Adjusting during render rather than
  // in an effect avoids rendering the stale open sheet for a frame first.
  if (sheetPath !== pathname) {
    setSheetPath(pathname);
    setSheetOpen(false);
  }

  useEffect(() => {
    if (!sheetOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [sheetOpen]);

  // "More" counts as active whenever the open screen isn't one of the tabs.
  const onSecondaryScreen = !PRIMARY_NAV_ITEMS.some((item) => isActivePath(pathname, item.href));

  return (
    <>
      {sheetOpen && (
        <div className="app-sheet-backdrop" onClick={() => setSheetOpen(false)} aria-hidden="true" />
      )}

      <div
        id="app-more-sheet"
        className={`app-sheet${sheetOpen ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="All screens"
        hidden={!sheetOpen}
      >
        <div className="app-sheet-grabber" aria-hidden="true" />
        <div className="app-sheet-body nice-scroll">
          {NAV_SECTIONS.map((section) => (
            <div key={section.id} className="app-sheet-group">
              <p className="app-nav-group-label">{section.label}</p>
              <ul>
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
                      className={`app-sheet-link${isActivePath(pathname, item.href) ? " active" : ""}`}
                    >
                      <NavIcon name={item.icon} className="app-nav-icon" />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {sheetFooter && <div className="app-sheet-footer">{sheetFooter}</div>}
        </div>
      </div>

      <nav className="app-tabbar elev-nav" aria-label="Primary">
        {PRIMARY_NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`app-tab${active ? " active" : ""}`}
            >
              <NavIcon name={item.icon} className="app-tab-icon" />
              <span>{item.label === "Player vs Player" ? "PvP" : item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setSheetOpen((open) => !open)}
          aria-expanded={sheetOpen}
          aria-controls="app-more-sheet"
          className={`app-tab${sheetOpen || onSecondaryScreen ? " active" : ""}`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className="app-tab-icon"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
