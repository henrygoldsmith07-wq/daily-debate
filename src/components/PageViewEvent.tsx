"use client";

import { useEffect } from "react";
import { trackEvent, type ClientEventName } from "@/lib/trackClientEvent";

const STRICT_MODE_DEDUPE_MS = 2_000;

/**
 * Records a page view only after the route has actually mounted in the browser.
 * A short sessionStorage window prevents React development remounts from
 * double-counting without hiding genuine later return visits.
 */
export default function PageViewEvent({ name }: { name: ClientEventName }) {
  useEffect(() => {
    const key = `daily-debate:view:${name}:${window.location.pathname}`;
    const now = Date.now();
    try {
      const previous = Number(window.sessionStorage.getItem(key) ?? "0");
      if (Number.isFinite(previous) && now - previous < STRICT_MODE_DEDUPE_MS) return;
      window.sessionStorage.setItem(key, String(now));
    } catch {
      // Storage can be unavailable in hardened/private browsing. Tracking the
      // mounted view is still preferable to dropping it entirely.
    }
    trackEvent(name);
  }, [name]);

  return null;
}
