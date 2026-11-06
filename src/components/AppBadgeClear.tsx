"use client";

import { useEffect } from "react";

/**
 * Clears the home-screen app badge once today is practised. The push service
 * worker sets the badge when a reminder arrives (copied from Duolingo's icon
 * badge), so the badge means "today is still open" until the learner
 * debates. Browsers without the Badging API do nothing.
 */
export default function AppBadgeClear() {
  useEffect(() => {
    const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
    nav.clearAppBadge?.().catch(() => undefined);
  }, []);
  return null;
}
