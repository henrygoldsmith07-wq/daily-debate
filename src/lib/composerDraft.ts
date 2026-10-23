/**
 * Unsent-draft persistence for the debate composer. A reload, an accidental
 * back-swipe or a mobile browser evicting the tab used to discard a half-typed
 * argument. Drafts live in sessionStorage (this tab only, cleared when the tab
 * closes), keyed per debate turn, and expire so a stale draft never resurfaces.
 */
export const DRAFT_PREFIX = "dd:composer-draft:";
export const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadDraft(key: string, now: number = Date.now(), storage: StorageLike | null = defaultStorage()): string {
  if (!storage) return "";
  try {
    const raw = storage.getItem(DRAFT_PREFIX + key);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { text?: unknown; savedAt?: unknown };
    if (typeof parsed.text !== "string" || typeof parsed.savedAt !== "number") {
      storage.removeItem(DRAFT_PREFIX + key);
      return "";
    }
    if (now - parsed.savedAt > DRAFT_MAX_AGE_MS || parsed.savedAt > now + 60_000) {
      storage.removeItem(DRAFT_PREFIX + key);
      return "";
    }
    return parsed.text;
  } catch {
    return "";
  }
}

export function saveDraft(key: string, text: string, now: number = Date.now(), storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (!text.trim()) storage.removeItem(DRAFT_PREFIX + key);
    else storage.setItem(DRAFT_PREFIX + key, JSON.stringify({ text, savedAt: now }));
  } catch {
    // Quota or private-mode failure: losing the draft is the old behaviour.
  }
}

export function clearDraft(key: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // ignore
  }
}
