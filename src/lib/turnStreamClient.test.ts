import { describe, expect, it } from "vitest";
import { encodeSseEvent } from "./sse";
import { readTurnResponse } from "./turnStreamClient";

function streamResponse(parts: string[], opts: { cutAfter?: number } = {}): Response {
  const enc = new TextEncoder();
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        if (opts.cutAfter !== undefined && i === opts.cutAfter) return c.error(new TypeError("network error"));
        if (i >= parts.length) return c.close();
        c.enqueue(enc.encode(parts[i++]));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("readTurnResponse", () => {
  it("passes a plain JSON answer through with its status", async () => {
    const res = new Response(JSON.stringify({ error: "stale", code: "stale_turn" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
    expect(await readTurnResponse(res)).toEqual({ status: 409, body: { error: "stale", code: "stale_turn" } });
  });

  it("reports start, deltas and resets in order and returns the result event", async () => {
    const log: string[] = [];
    const frames =
      encodeSseEvent("start", {}) +
      encodeSseEvent("delta", { text: "Bad " }) +
      encodeSseEvent("reset", {}) +
      encodeSseEvent("delta", { text: "Good" }) +
      encodeSseEvent("result", { status: 200, body: { nextTurn: { id: "t2" } } });
    // Deliver in awkward 5-byte pieces to exercise reassembly.
    const pieces = frames.match(/[\s\S]{1,5}/g)!;
    const outcome = await readTurnResponse(streamResponse(pieces), {
      onStart: () => log.push("start"),
      onDelta: (t) => log.push(`delta:${t}`),
      onReset: () => log.push("reset"),
    });
    expect(log).toEqual(["start", "delta:Bad ", "reset", "delta:Good"]);
    expect(outcome).toEqual({ status: 200, body: { nextTurn: { id: "t2" } } });
  });

  it("returns the saved-response failure carried in the result event", async () => {
    const outcome = await readTurnResponse(
      streamResponse([encodeSseEvent("result", { status: 502, body: { submissionSaved: true, error: "saved" } })]),
    );
    expect(outcome?.status).toBe(502);
    expect(outcome?.body.submissionSaved).toBe(true);
  });

  it("returns null when the connection is cut before the result, so the caller can recover", async () => {
    const deltas: string[] = [];
    const outcome = await readTurnResponse(
      streamResponse([encodeSseEvent("start", {}), encodeSseEvent("delta", { text: "half" })], { cutAfter: 2 }),
      { onDelta: (t) => deltas.push(t) },
    );
    expect(deltas).toEqual(["half"]);
    expect(outcome).toBeNull();
  });

  it("returns null for a stream that closes cleanly without a result", async () => {
    expect(await readTurnResponse(streamResponse([encodeSseEvent("start", {})]))).toBeNull();
  });

  it("rethrows an abort so leaving the room is not treated as a cut connection", async () => {
    const controller = new AbortController();
    const res = new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      headers: { "content-type": "text/event-stream" },
    });
    const pending = readTurnResponse(res, {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
