"use client";

import { useState } from "react";

/**
 * Share a practice result: the system share sheet where there is one, the
 * clipboard where there is not. The text is built by the caller from what the
 * practice observed, so nothing here can overstate it. `path` (relative) is
 * resolved against the current origin at click time.
 */
export default function ShareResultButton({
  title,
  text,
  url,
  path,
  onShared,
}: {
  title: string;
  text: string;
  url?: string;
  path?: string;
  /** Called once a share sheet or copy actually completed. */
  onShared?: () => void;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function share() {
    const target = path ? new URL(path, window.location.origin).href : url ?? window.location.origin;
    const payload = { title, text, url: target };
    try {
      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(payload))) {
        await navigator.share(payload);
        onShared?.();
        return;
      }
      await navigator.clipboard.writeText(`${payload.text}\n${payload.url}`);
      setState("copied");
      onShared?.();
    } catch (error) {
      // Dismissing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState("failed");
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" onClick={() => void share()} className="btn btn-secondary px-4 py-2 text-sm">
        Share result <span aria-hidden="true">↗</span>
      </button>
      <span className="text-xs text-ink3" aria-live="polite">
        {state === "copied" ? "Copied to your clipboard." : state === "failed" ? "Could not share from this browser." : ""}
      </span>
    </div>
  );
}
