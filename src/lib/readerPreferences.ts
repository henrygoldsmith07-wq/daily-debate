"use client";

// Reader preferences: large text, dyslexia-friendly type, high contrast, and
// reduced motion.
//
// The CSS for all four already existed in le-studio.css as opt-in classes on
// <html>, but nothing ever applied them, so a genuinely useful accessibility
// affordance was dead code. This hook connects it.
//
// Deliberately localStorage rather than a profile column: a reader who asks for
// larger text should get it immediately, on the marketing page, before signing
// in, and without a migration to ship it. If accounts later gain a preferences
// column, persisting the same values there is additive, not a rewrite.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

export type ReaderPreferenceKey = "large-text" | "dyslexia" | "high-contrast" | "reduce-motion";

export interface ReaderPreferenceOption {
  key: ReaderPreferenceKey;
  label: string;
  /** What turning it on actually does. */
  description: string;
}

/**
 * All four are independent; the CSS is written so stacking them is safe.
 */
export const READER_PREFERENCE_OPTIONS: readonly ReaderPreferenceOption[] = [
  {
    key: "large-text",
    label: "Larger text",
    description: "Scale the whole interface up to 112.5%.",
  },
  {
    key: "high-contrast",
    label: "Higher contrast",
    description: "Strengthen text and borders for low-vision reading.",
  },
  {
    key: "dyslexia",
    label: "Dyslexia-friendly type",
    description: "A rounded face with wider spacing and line height.",
  },
  {
    key: "reduce-motion",
    label: "Reduce motion",
    description: "Stop transitions and looping animations. Your device may already do this.",
  },
] as const;

const STORAGE_KEY = "daily-debate:reader-preferences";
const CHANGE_EVENT = "daily-debate:reader-preferences-changed";
const ALL_KEYS: readonly ReaderPreferenceKey[] = ["high-contrast", "reduce-motion", "dyslexia", "large-text"];

const CLASS_BY_KEY: Record<ReaderPreferenceKey, string> = {
  "large-text": "large-text",
  dyslexia: "dyslexia",
  "high-contrast": "high-contrast",
  "reduce-motion": "reduce-motion",
};

function isPreferenceKey(value: unknown): value is ReaderPreferenceKey {
  return typeof value === "string" && (ALL_KEYS as readonly string[]).includes(value);
}

/**
 * A stable serialisation of the stored preference set.
 *
 * `useSyncExternalStore` requires getSnapshot to return a referentially stable
 * value, so this caches the derived snapshot against the raw string it came
 * from. Returning a fresh object each call would loop forever.
 */
let snapshotCache: { raw: string | null; value: string } = { raw: null, value: "" };

function readSnapshot(): string {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (snapshotCache.raw === raw) return snapshotCache.value;

  let value = "";
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Sorted, so key order in storage never changes the snapshot identity.
        value = parsed.filter(isPreferenceKey).sort().join(",");
      }
    } catch {
      value = "";
    }
  }
  snapshotCache = { raw, value };
  return value;
}

function subscribe(onChange: () => void): () => void {
  // The custom event covers this tab; `storage` covers other tabs.
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function getServerSnapshot(): string {
  // Preferences are device-local, so a server render has none.
  return "";
}

/**
 * Apply a preference set to <html>.
 *
 * Exported (rather than living only in an effect body) so the layout's inline
 * pre-hydration script can share the same class names and cannot drift.
 */
export function applyReaderPreferences(enabled: ReadonlySet<ReaderPreferenceKey>, root: HTMLElement): void {
  for (const [key, className] of Object.entries(CLASS_BY_KEY)) {
    root.classList.toggle(className, enabled.has(key as ReaderPreferenceKey));
  }
}

export interface ReaderPreferences {
  enabled: ReadonlySet<ReaderPreferenceKey>;
  isEnabled: (key: ReaderPreferenceKey) => boolean;
  toggle: (key: ReaderPreferenceKey) => void;
}

export function useReaderPreferences(): ReaderPreferences {
  // The serialised snapshot is the external state; the Set is derived from it,
  // which keeps the store's identity stable across renders.
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!snapshot) return;
    applyReaderPreferences(new Set(snapshot.split(",").filter(isPreferenceKey)), document.documentElement);
  }, [snapshot]);

  // Memoised so the derived Set's identity is stable for the callback below:
  // the external snapshot only changes when storage actually changes.
  const enabled = useMemo(
    () => new Set(snapshot ? (snapshot.split(",").filter(isPreferenceKey) as ReaderPreferenceKey[]) : []),
    [snapshot],
  );

  const toggle = useCallback((key: ReaderPreferenceKey) => {
    let next: string[] = [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      next = Array.isArray(parsed) ? parsed.filter(isPreferenceKey) : [];
    } catch {
      next = [];
    }
    const index = next.indexOf(key);
    if (index === -1) next.push(key);
    else next.splice(index, 1);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode, quota). The change still takes
      // effect for this session via the event below.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }, []);

  const isEnabled = useCallback((key: ReaderPreferenceKey) => enabled.has(key), [enabled]);

  return { enabled, isEnabled, toggle };
}
