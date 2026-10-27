// Clipboard copy for client components. `navigator.clipboard` exists only in
// secure contexts, so a plain `navigator.clipboard.writeText(...)` on an
// http:// origin (or inside a non-secure preview iframe) throws a TypeError
// that surfaces as an unhandled rejection and the button appears dead — the
// exact failure DebateResultCard.tsx guards against inline. This helper keeps
// that guard in one place, adds the legacy `execCommand("copy")` fallback for
// exactly those insecure contexts, and returns the outcome so the UI can
// acknowledge a copy or tell the reader it failed. No React, no DOM at import.

export type CopyOutcome = "copied" | "failed";

interface ClipboardLike {
  writeText?: (text: string) => Promise<void>;
}

export interface CopyTextDeps {
  /** Defaults to `navigator.clipboard`. */
  clipboard?: ClipboardLike | null;
  /**
   * Legacy fallback, injected so tests run without a DOM. The default
   * implementation uses a temporary textarea + execCommand, which still works
   * in insecure contexts where the async clipboard API is absent.
   */
  execCommandCopy?: (text: string) => boolean;
}

function legacyExecCommandCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copy `text` and report what happened. Tries the async clipboard API first
 * (secure contexts), falls back to the legacy path when the API is missing or
 * rejects (user permission denied), and never throws.
 */
export async function copyText(text: string, deps: CopyTextDeps = {}): Promise<CopyOutcome> {
  const clipboard = deps.clipboard ?? (typeof navigator === "undefined" ? null : navigator.clipboard);
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return "copied";
    } catch {
      // Permission denied or the write failed: the legacy path below still has
      // a chance, and a failed copy must not crash the calling handler.
    }
  }
  const legacy = deps.execCommandCopy ?? legacyExecCommandCopy;
  return legacy(text) ? "copied" : "failed";
}
