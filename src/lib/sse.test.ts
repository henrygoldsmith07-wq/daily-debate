import { describe, expect, it } from "vitest";
import { createSseParser, encodeSseEvent, readSseStream, SseIdleTimeoutError, type SseEvent } from "./sse";

function collect(chunks: string[], end = true): SseEvent[] {
  const events: SseEvent[] = [];
  const parser = createSseParser((e) => events.push(e));
  for (const c of chunks) parser.push(c);
  if (end) parser.end();
  return events;
}

function byteStream(parts: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(typeof p === "string" ? enc.encode(p) : p);
      c.close();
    },
  });
}

describe("createSseParser", () => {
  it("parses OpenAI-style data lines and the [DONE] sentinel", () => {
    const events = collect(['data: {"a":1}\n\n', "data: [DONE]\n\n"]);
    expect(events).toEqual([
      { event: "message", data: '{"a":1}' },
      { event: "message", data: "[DONE]" },
    ]);
  });

  it("reassembles an event whose line is split mid-way across chunks", () => {
    const events = collect(['da', 'ta: {"choices":[{"delta":{"con', 'tent":"Hi"}}]}', "\n", "\n"]);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data).choices[0].delta.content).toBe("Hi");
  });

  it("does not dispatch an event until its blank line arrives", () => {
    expect(collect(["data: partial\n"], false)).toEqual([]);
  });

  it("handles CRLF line endings, including a CR/LF pair split across chunks", () => {
    const events = collect(["event: delta\r\ndata: x\r", "\n\r\n"]);
    expect(events).toEqual([{ event: "delta", data: "x" }]);
  });

  it("joins multi-line data and ignores comments and keep-alives", () => {
    const events = collect([": keep-alive\n\n", "data: one\ndata: two\n\n"]);
    expect(events).toEqual([{ event: "message", data: "one\ntwo" }]);
  });

  it("dispatches a final unterminated event at end of stream", () => {
    expect(collect(["data: [DONE]"])).toEqual([{ event: "message", data: "[DONE]" }]);
  });

  it("round-trips the route's own named events", () => {
    const frames = encodeSseEvent("delta", { text: "line\nbreak" }) + encodeSseEvent("result", { status: 200, body: {} });
    const events = collect([frames]);
    expect(events.map((e) => e.event)).toEqual(["delta", "result"]);
    expect(JSON.parse(events[0].data)).toEqual({ text: "line\nbreak" });
  });
});

describe("readSseStream", () => {
  it("decodes a multi-byte character split across network reads", async () => {
    const bytes = new TextEncoder().encode('data: {"t":"é"}\n\n');
    const split = bytes.indexOf(0xc3) + 1; // inside the 2-byte é
    const events: SseEvent[] = [];
    await readSseStream(byteStream([bytes.slice(0, split), bytes.slice(split)]), (e) => events.push(e));
    expect(JSON.parse(events[0].data).t).toBe("é");
  });

  it("rejects with an idle-timeout error when the stream stalls", async () => {
    const stalled = new ReadableStream<Uint8Array>({ start() {} });
    await expect(readSseStream(stalled, () => {}, { idleTimeoutMs: 20 })).rejects.toBeInstanceOf(SseIdleTimeoutError);
  });
});
