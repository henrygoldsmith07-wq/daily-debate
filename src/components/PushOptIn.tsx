"use client";

import { useEffect, useState } from "react";

/**
 * Opt in to push reminders for this browser. Shown on Today only after the
 * first completed debate, so the ask comes once the learner has seen the
 * loop. At most one push a day, early evening, never in quiet hours.
 */

type State = "checking" | "unsupported" | "ios-install" | "off" | "on" | "blocked" | "working" | "error";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIosBrowserTab(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export default function PushOptIn({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: State;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        next = isIosBrowserTab() ? "ios-install" : "unsupported";
      } else if (Notification.permission === "denied") {
        next = "blocked";
      } else {
        const registration = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
        const existing = await registration?.pushManager.getSubscription().catch(() => null);
        next = existing ? "on" : "off";
      }
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const res = await fetch("/api/push/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error(`subscribe ${res.status}`);
      setState("on");
    } catch {
      setState("error");
    }
  }

  async function turnOff() {
    setState("working");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      await fetch("/api/push/subscription", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription?.endpoint ?? null }),
      });
      await subscription?.unsubscribe();
      setState("off");
    } catch {
      setState("error");
    }
  }

  if (state === "checking" || state === "unsupported") return null;

  return (
    <section className="surface-card p-5" aria-labelledby="push-heading" data-testid="push-optin" data-state={state}>
      <h2 id="push-heading" className="text-sm font-semibold">
        {state === "on" ? "Reminders are on for this device" : "Get a nudge before your streak breaks"}
      </h2>
      <p className="mt-1 text-xs text-ink3">
        At most one a day, between 17:00 and 21:00 your time, only on days you haven&apos;t practised yet. We do not
        claim reminders improve results.
      </p>
      {state === "ios-install" ? (
        <p className="mt-3 text-xs text-ink2">
          On iPhone and iPad, reminders need the app on your Home Screen: tap Share, then Add to Home Screen, and
          open Daily Debate from there.
        </p>
      ) : state === "blocked" ? (
        <p className="mt-3 text-xs text-ink2">Notifications are blocked for this site in your browser settings.</p>
      ) : (
        <button
          type="button"
          className="btn btn-secondary mt-3 px-4 py-2 text-sm"
          onClick={() => void (state === "on" ? turnOff() : turnOn())}
          disabled={state === "working"}
          aria-pressed={state === "on"}
          data-testid="push-toggle"
        >
          {state === "on" ? "Turn reminders off" : state === "working" ? "One moment…" : "Turn on reminders"}
        </button>
      )}
      {state === "error" ? (
        <p className="mt-2 text-xs text-[var(--review)]" role="status">
          That didn&apos;t work. Try again in a moment.
        </p>
      ) : null}
    </section>
  );
}
