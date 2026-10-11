"use client";

import { useEffect } from "react";
import { GUEST_LOOP_STORAGE_KEY } from "@/lib/guestLoop";

/**
 * Drop the localStorage guest-loop hand-off once the account has it.
 *
 * The summary is a one-shot hand-off, not a durable record. Leaving it meant a
 * later signup on the same browser re-attached an older guest's practice run to
 * a brand-new account, and a shared computer kept one visitor's summary sitting
 * in storage for the next person's signup.
 *
 * Rendered ONLY when the signed-in page has already read a guest context off
 * the profile — that read is the proof the server received and stored it, so
 * clearing here can never race a signup that has not landed yet. A signup that
 * failed keeps the value (no carry-over rendered, nothing cleared) and the
 * retry re-posts it.
 */
export default function ClearGuestLoopHandoff() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(GUEST_LOOP_STORAGE_KEY);
    } catch {
      // Storage unavailable: nothing to clear, nothing broken.
    }
  }, []);

  return null;
}
