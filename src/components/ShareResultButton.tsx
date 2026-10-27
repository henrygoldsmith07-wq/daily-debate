"use client";

import { useState } from "react";

/**
 * Share a practice result: the system share sheet where there is one, the
 * clipboard where there is not. The text is built by the caller from what the
 * practice observed, so nothing here can overstate it.
 */
export default function ShareResultButton({ title, text, url }: { title: string; text: string; url?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function share() {
    const payload = { title, text, url: url ?? window.location.origin };
    try {
      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(payload))) {
        await navigator.share(payload);
        return;
      }
      await navigator.clipboard.writeText(`${payload.text} ${payload.url}`);
      setState("copied");
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
