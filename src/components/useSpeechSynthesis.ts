"use client";

import { useCallback, useSyncExternalStore } from "react";

function subscribeNoop() {
  return () => {};
}

export function useSpeechSynthesis() {
  const supported = useSyncExternalStore(
    subscribeNoop,
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false,
  );

  const speak = useCallback((text: string, onDone?: () => void) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      onDone?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      onDone?.();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  }, []);

  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  return { supported, speak, cancel };
}
