"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

// Minimal ambient shape for the (non-standard, Chrome-only) Web Speech API
// Safari/Firefox: no SpeechRecognition — composer shows dictation + paste + keyboard path instead. —
// not part of TypeScript's DOM lib.
interface SpeechRecognitionResultLike {
  transcript: string;
}
interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function subscribeNoop() {
  return () => {};
}

export function useSpeechRecognition(opts?: { lang?: string }) {
  const lang = opts?.lang ?? "en-US";
  const supported = useSyncExternalStore(
    subscribeNoop,
    () => getSpeechRecognitionCtor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition not supported in this browser — try Chrome/Edge, or type your response.");
      return;
    }
    setError(null);
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      let combined = "";
      let interimText = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const r = event.results[i] as unknown as { isFinal?: boolean } & ArrayLike<SpeechRecognitionResultLike>;
        const text = (r[0] as SpeechRecognitionResultLike)?.transcript ?? "";
        if (r.isFinal) combined += text + " ";
        else interimText += text;
      }
      if (combined) setTranscript((prev) => (prev ? prev + " " : "") + combined.trim());
      setInterim(interimText);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setError("Mic error — check permissions and try again, or type.");
      setListening(false);
    };
    recognitionRef.current = recognition;
    setTranscript("");
    setInterim("");
    setListening(true);
    try {
      recognition.start();
    } catch {
      setError("Could not start microphone — check permissions.");
      setListening(false);
    }
  }, [lang]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, transcript, interim, error, start, stop, resetTranscript: () => { setTranscript(""); setInterim(""); setError(null); } };
}
