// Server-Sent Events: an incremental parser and an encoder.
//
// Used twice on the streamed opponent turn:
//   - server side, to read OpenAI-compatible `stream: true` completions
//     (`data: {...}` lines terminated by `data: [DONE]`);
//   - client side, to read the turn route's own event stream
//     (`event: delta|reset|result`).
//
// Network chunks are arbitrary byte boundaries, so a line — or a multi-byte
// UTF-8 character — can be split across two reads. The parser buffers the
// unterminated tail and only dispatches complete events (spec: an event ends
// at a blank line; lines end with LF, CR or CRLF).

export interface SseEvent {
  /** `event:` field; "message" when the event names none (per the spec). */
  event: string;
  /** All `data:` lines joined with "\n". */
  data: string;
}

export interface SseParser {
  /** Feed the next decoded text chunk. Dispatches every event it completes. */
  push(chunk: string): void;
  /**
   * End of stream. A final event that was never terminated by a blank line is
   * dispatched (providers commonly omit the trailing blank line after
   * `data: [DONE]`).
   */
  end(): void;
}

export function createSseParser(onEvent: (event: SseEvent) => void): SseParser {
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];
  let sawField = false;

  const dispatch = () => {
    if (sawField && dataLines.length > 0) {
      onEvent({ event: eventName || "message", data: dataLines.join("\n") });
    }
    eventName = "";
    dataLines = [];
    sawField = false;
  };

  const processLine = (line: string) => {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return; // comment / keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") {
      dataLines.push(value);
      sawField = true;
    } else if (field === "event") {
      eventName = value;
      sawField = true;
    }
    // `id` and `retry` are not used by either side.
  };

  const drain = (final: boolean) => {
    let start = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const ch = buffer[i];
      if (ch !== "\n" && ch !== "\r") continue;
      // A CR at the very end of a chunk may be the first half of a CRLF.
      if (ch === "\r" && i === buffer.length - 1 && !final) break;
      processLine(buffer.slice(start, i));
      if (ch === "\r" && buffer[i + 1] === "\n") i += 1;
      start = i + 1;
    }
    buffer = buffer.slice(start);
  };

  return {
    push(chunk: string) {
      if (!chunk) return;
      buffer += chunk;
      drain(false);
    },
    end() {
      drain(true);
      if (buffer.length) processLine(buffer);
      buffer = "";
      dispatch();
    },
  };
}

/** Read a byte stream to completion, dispatching SSE events as they complete. */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
  opts: { idleTimeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser(onEvent);
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  opts.signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = reader.read();
      const result = opts.idleTimeoutMs
        ? await Promise.race([
            next,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new SseIdleTimeoutError(opts.idleTimeoutMs!)), opts.idleTimeoutMs);
            }),
          ]).finally(() => clearTimeout(timer))
        : await next;
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (result.done) break;
      parser.push(decoder.decode(result.value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } catch (error) {
    abort();
    throw error;
  } finally {
    opts.signal?.removeEventListener("abort", abort);
  }
}

export class SseIdleTimeoutError extends Error {
  constructor(ms: number) {
    super(`Stream stalled: no data for ${ms}ms`);
    this.name = "SseIdleTimeoutError";
  }
}

/** One SSE frame. `data` is JSON-encoded, so it never contains a raw newline. */
export function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
