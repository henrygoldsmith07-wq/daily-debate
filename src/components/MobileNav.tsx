"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import NavIcon from "./NavIcon";
import { NAV_SECTIONS, PRIMARY_NAV_ITEMS, isActivePath } from "@/lib/nav";

/**
 * Small-screen navigation: a fixed bottom tab bar for the screens people open
 * daily, plus a sheet holding everything else. The sheet closes on navigation,
 * on Escape, and on a backdrop tap, and body scroll is locked while it is up.
 */
export default function MobileNav({ sheetFooter }: { sheetFooter?: React.ReactNode }) {
  const pathname = usePathname();
  const [sheetOpenPath, setSheetOpenPath] = useState<string | null>(null);
  const sheetOpen = sheetOpenPath === pathname;
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const closeSheet = () => setSheetOpenPath(null);

  useEffect(() => {
    if (!sheetOpen) {
      if (wasOpenRef.current) triggerRef.current?.focus();
      wasOpenRef.current = false;
      return;
    }
    wasOpenRef.current = true;
    const sheet = sheetRef.current;
    const focusables = () =>
      Array.from(
        sheet?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("hidden"));
    requestAnimationFrame(() => focusables()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusables();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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
        <div className="app-sheet-backdrop" onClick={closeSheet} aria-hidden="true" />
      )}

      <div
        ref={sheetRef}
        id="app-more-sheet"
        className={`app-sheet${sheetOpen ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-more-sheet-title"
        hidden={!sheetOpen}
      >
        <div className="app-sheet-grabber" aria-hidden="true" />
        <div className="app-sheet-body nice-scroll">
          <h2 id="app-more-sheet-title" className="sr-only">All screens</h2>
          {NAV_SECTIONS.map((section) => (
            <div key={section.id} className="app-sheet-group">
              <p className="app-nav-group-label">{section.label}</p>
              <ul>
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={closeSheet}
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
          ref={triggerRef}
          type="button"
          onClick={() => setSheetOpenPath(sheetOpen ? null : pathname)}
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
