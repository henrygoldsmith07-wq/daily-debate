"use client";

// Theme preference.
//
// Daily Debate is dark by design and stays dark by default. Until now that was
// the only option: <html> carried a hard-coded `dark` class, so a reader on a
// light-mode phone, or reading in daylight, had no way out. The Le Studio
// tokens already render the light theme correctly, so this offers it as a
// reading-comfort choice, stored on this device like the other preferences.
//
// The inline script in layout.tsx (THEME_BOOTSTRAP) applies the same rule
// before first paint, so a light-theme reader never sees a dark flash.

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_THEME, normaliseTheme, resolveTheme, THEME_COLOR, THEME_STORAGE_KEY, type ThemePreference } from "./themeBootstrap";

export * from "./themeBootstrap";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const CHANGE_EVENT = "daily-debate:theme-change";

function prefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

function readPreference(): ThemePreference {
  try {
    return normaliseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(preference, prefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", THEME_COLOR[resolved]));
}

function subscribe(onChange: () => void): () => void {
  const media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  const onSystem = () => {
    if (readPreference() === "system") applyTheme("system");
    onChange();
  };
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  media?.addEventListener?.("change", onSystem);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
    media?.removeEventListener?.("change", onSystem);
  };
}

export function useThemePreference(): { theme: ThemePreference; setTheme: (next: ThemePreference) => void } {
  const theme = useSyncExternalStore(subscribe, readPreference, () => DEFAULT_THEME);
  const setTheme = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode: applies for this page view only */
    }
    applyTheme(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return { theme, setTheme };
}
