"use client";

// Speech / audio behaviour for the debate room.
//
// Kept separate from the session hook so the timing rules around the
// opponent speaking are readable on their own: the response clock must not
// start until the opponent has finished speaking, and speech is purely
// optional (the room stays fully playable with no speech support).

import { useCallback, useRef, useState } from "react";
import { useSpeechSynthesis } from "../useSpeechSynthesis";

export interface DebateSpeech {
  /** True while the opponent is being read aloud. */
  opponentSpeaking: boolean;
  supported: boolean;
  /**
   * Speak the opponent's turn and run `onDone` when it finishes.
   *
   * When speech is unavailable `onDone` still runs, so the caller can start
   * the response window without branching on support.
   */
  speakOpponentTurn: (text: string, onDone: () => void) => void;
}

export function useDebateSpeech(): DebateSpeech {
  const { speak, supported } = useSpeechSynthesis();
  const [opponentSpeaking, setOpponentSpeaking] = useState(false);
  // Keep the latest completion callback reachable from the speech handler
  // without re-subscribing on every render.
  const onDoneRef = useRef<(() => void) | null>(null);

  const speakOpponentTurn = useCallback(
    (text: string, onDone: () => void) => {
      if (!supported) {
        onDone();
        return;
      }
      onDoneRef.current = onDone;
      setOpponentSpeaking(true);
      speak(text, () => {
        setOpponentSpeaking(false);
        const done = onDoneRef.current;
        onDoneRef.current = null;
        done?.();
      });
    },
    [speak, supported],
  );

  return { opponentSpeaking, supported, speakOpponentTurn };
}
