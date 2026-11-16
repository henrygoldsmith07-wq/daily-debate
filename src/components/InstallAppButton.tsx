"use client";

import { useEffect, useState } from "react";

/**
 * "Install the app": one tap to put Daily Debate on the home screen, copied
 * from direct competitors that ship as phone apps (ArguFight, MindDuel). It
 * uses the browser's own install prompt (Chrome, Edge, Android), so it shows
 * only where that prompt exists and never in an installed app. iPhone and
 * iPad have no such prompt; PushOptIn already explains Add to Home Screen
 * there. Dismissing it is remembered in this browser only.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "daily-debate-install-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Storage unavailable: the button simply comes back next visit.
  }
}

export default function InstallAppButton() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (readDismissed() || window.matchMedia?.("(display-mode: standalone)").matches) return;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!promptEvent || hidden) return null;

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt().catch(() => undefined);
    const choice = await promptEvent.userChoice.catch(() => null);
    if (choice?.outcome === "dismissed") writeDismissed();
    setHidden(true);
  }

  return (
    <section className="surface-card flex flex-wrap items-center justify-between gap-3 p-4" data-testid="install-app">
      <p className="text-sm text-ink2">Put Daily Debate on your home screen: it opens like an app, straight to today&apos;s motion.</p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => void install()}>
          Install the app
        </button>
        <button
          type="button"
          className="btn btn-ghost px-3 py-1.5 text-xs"
          onClick={() => {
            writeDismissed();
            setHidden(true);
          }}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
