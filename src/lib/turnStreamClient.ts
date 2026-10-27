// Client side of the streamed solo turn (see the turn route's streamTurn).
//
// The route answers either plain JSON (anything that needs no generation or
// failed before the response was staged) or an event stream ending in a
// `result` event that carries exactly the JSON the non-streaming route would
// have answered. This reader turns both into the same { status, body } so the
// caller keeps ONE code path for success, saved-response failures and errors.
//
// It returns null when a stream ends without its result (the connection was
// cut mid-reply). The caller then falls back to a plain JSON request for the
// same submission, which the route answers idempotently: the committed round
// is replayed, or the saved response is reported as still generating.

import { readSseStream } from "./sse";

export interface TurnOutcome {
  status: number;
  body: Record<string, unknown>;
}

export interface TurnStreamCallbacks {
  /** The server has durably staged the response and is generating the reply. */
  onStart?: () => void;
  /** The next piece of the opponent's reply. */
  onDelta?: (text: string) => void;
  /** Discard any reply text shown so far. */
  onReset?: () => void;
}

/** Ask for a stream; servers or proxies that cannot stream answer JSON. */
export const TURN_STREAM_ACCEPT = "text/event-stream, application/json";

/** A stalled stream (no bytes at all, not even a delta) is abandoned after this long. */
const CLIENT_IDLE_TIMEOUT_MS = 60_000;

export function isEventStream(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("text/event-stream");
}

export async function readTurnResponse(
  res: Response,
  callbacks: TurnStreamCallbacks = {},
  signal?: AbortSignal,
): Promise<TurnOutcome | null> {
  if (!isEventStream(res) || !res.body) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: body ?? {} };
  }

  let outcome: TurnOutcome | null = null;
  try {
    await readSseStream(
      res.body,
      (event) => {
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (event.event) {
          case "start":
            callbacks.onStart?.();
            break;
          case "delta": {
            const text = (data as { text?: unknown })?.text;
            if (typeof text === "string" && text) callbacks.onDelta?.(text);
            break;
          }
          case "reset":
            callbacks.onReset?.();
            break;
          case "result": {
            const status = (data as { status?: unknown })?.status;
            const body = (data as { body?: unknown })?.body;
            if (typeof status === "number" && body && typeof body === "object") {
              outcome = { status, body: body as Record<string, unknown> };
            }
            break;
          }
        }
      },
      { idleTimeoutMs: CLIENT_IDLE_TIMEOUT_MS, signal },
    );
  } catch (error) {
    if (signal?.aborted || (error as Error)?.name === "AbortError") throw error;
    // A cut connection: fall through and let the caller recover.
  }
  return outcome;
}
