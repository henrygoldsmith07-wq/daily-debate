"use client";

// Reader-preference controls.
//
// The design system has shipped the CSS for these four classes since it was
// added to le-studio.css, but no surface ever applied them — so "larger text",
// "higher contrast", "dyslexia-friendly type" and "reduce motion" were
// unreachable. This is that surface: a disclosure panel so it never competes
// with the product's primary actions.

import { useId, useState, type KeyboardEvent } from "react";
import { READER_PREFERENCE_OPTIONS, useReaderPreferences } from "@/lib/readerPreferences";
import { THEME_OPTIONS, useThemePreference } from "@/lib/themePreference";

export default function ReaderPreferences() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { isEnabled, toggle } = useReaderPreferences();
  const { theme, setTheme } = useThemePreference();

  function onThemeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // WAI-ARIA radio keyboard interaction: arrows move between the options and
    // Home/End jump to the first/last. Only the checked radio is tabbable, so
    // focus must follow the newly selected radio, otherwise it would land on a
    // button that is no longer in the tab order while announcing as unchecked.
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    let nextIndex: number;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = THEME_OPTIONS.length - 1;
    else if (delta !== 0) {
      const currentIndex = THEME_OPTIONS.findIndex((option) => option.key === theme);
      nextIndex = (currentIndex + delta + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    } else return;

    event.preventDefault();
    const next = THEME_OPTIONS[nextIndex].key;
    setTheme(next);
    document.getElementById(`${panelId}-theme-${next}`)?.focus();
  }

  return (
    <div className="border-t border-[var(--rule)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-ink2 hover:text-ink"
        data-testid="reader-preferences-toggle"
      >
        Reading comfort
        <span aria-hidden="true" className="text-xs text-ink3">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div id={panelId} className="mt-3 flex flex-col gap-3" data-testid="reader-preferences-panel">
          <p className="text-xs leading-4 text-ink3">
            Stored on this device only. Applies immediately, including before you sign in.
          </p>

          <div>
            <p id={`${panelId}-theme`} className="text-sm font-medium text-ink2">Theme</p>
            <div
              role="radiogroup"
              aria-labelledby={`${panelId}-theme`}
              className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg border border-[var(--rule)] bg-surface-2 p-1"
              data-testid="theme-preference"
            >
              {THEME_OPTIONS.map((option) => {
                const selected = theme === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    id={`${panelId}-theme-${option.key}`}
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTheme(option.key)}
                    onKeyDown={onThemeKeyDown}
                    className={`min-h-9 rounded-md px-2 text-xs font-medium transition-colors ${selected ? "bg-surface text-ink shadow-sm" : "text-ink3 hover:text-ink2"}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {READER_PREFERENCE_OPTIONS.map((option) => {
            // useSyncExternalStore returns the server snapshot ("") until it
            // subscribes, so an enabled preference is simply not yet reflected
            // here rather than being shown as explicitly off.
            const checked = isEnabled(option.key);
            return (
              <label key={option.key} className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(option.key)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--speak)]"
                  data-testid={`reader-pref-${option.key}`}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-ink2">{option.label}</span>
                  <span className="block text-xs leading-4 text-ink3">{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
