import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Never mirror fake transport calls into a real ai_call_log (see openrouter.test.ts).
vi.mock("./aiTelemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./aiTelemetry")>()),
  recordAiCall: vi.fn(),
}));
import { PROVIDERS, __clearCooldownsForTests, debateTurnStream } from "./openrouter";

const PARAMS = {
  topicTitle: "T",
  topicPrompt: "P",
  userSide: "for" as const,
  history: [{ role: "ai" as const, text: "Opening argument." }],
  latestUserMessage: "My answer.",
};
const TURN = { feedback: "Add a cited source.", aiMessage: "But who bears the adjustment costs over time?" };

function sse(frames: string[], opts: { failAfter?: number } = {}): Response {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (opts.failAfter !== undefined && i === opts.failAfter) {
        c.error(new Error("socket hang up"));
        return;
      }
      if (i >= frames.length) {
        c.close();
        return;
      }
      c.enqueue(enc.encode(frames[i++]));
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Split `content` into OpenAI delta frames of `size` characters. */
function deltaFrames(content: string, size = 6): string[] {
  const frames: string[] = [];
  for (let i = 0; i < content.length; i += size) {
    frames.push(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + size) } }] })}\n\n`);
  }
  frames.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { total_tokens: 42 } })}\n\n`);
  frames.push("data: [DONE]\n\n");
  return frames;
}

describe("debateTurnStream", () => {
  beforeEach(() => {
    for (const p of PROVIDERS) vi.stubEnv(p.keyEnv, "");
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("OPENROUTER_MODEL", "m/one");
    vi.stubEnv("OPENROUTER_FALLBACK_MODELS", "m/two");
    vi.stubEnv("E2E_MOCK_AI", "");
    __clearCooldownsForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streams only the reply text and resolves with the validated object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse(deltaFrames(JSON.stringify(TURN))));
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    const onReset = vi.fn();
    const { result, servedBy } = await debateTurnStream(PARAMS, { onDelta: (t) => deltas.push(t), onReset });
    expect(result).toEqual(TURN);
    expect(servedBy).toEqual({ provider: "openrouter", model: "m/one" });
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(TURN.aiMessage);
    expect(onReset).not.toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
  });

  it("fails over silently when a model errors before the first token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "bad model" } }), { status: 404 }))
      .mockResolvedValueOnce(sse(deltaFrames(JSON.stringify(TURN))));
    vi.stubGlobal("fetch", fetchMock);
    const onReset = vi.fn();
    const deltas: string[] = [];
    const { result, servedBy } = await debateTurnStream(PARAMS, { onDelta: (t) => deltas.push(t), onReset });
    expect(result).toEqual(TURN);
    expect(servedBy.model).toBe("m/two");
    expect(onReset).not.toHaveBeenCalled();
    expect(deltas.join("")).toBe(TURN.aiMessage);
  });

  it("resets shown text and fails over when the stream dies mid-reply", async () => {
    const partial = deltaFrames(JSON.stringify({ aiMessage: "A first, doomed reply that", feedback: "x" }), 8);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sse(partial, { failAfter: 3 }))
      .mockResolvedValueOnce(sse(deltaFrames(JSON.stringify(TURN))));
    vi.stubGlobal("fetch", fetchMock);
    const events: string[] = [];
    let shown = "";
    const { result } = await debateTurnStream(PARAMS, {
      onDelta: (t) => {
        shown += t;
        events.push("delta");
      },
      onReset: () => {
        shown = "";
        events.push("reset");
      },
    });
    expect(result).toEqual(TURN);
    expect(events).toContain("reset");
    expect(events.indexOf("reset")).toBeGreaterThan(0);
    expect(shown).toBe(TURN.aiMessage);
  });

  it("treats a streamed reply that fails schema validation as a failure, never a result", async () => {
    const invalid = deltaFrames(JSON.stringify({ aiMessage: "Valid-looking reply text here.", feedback: "" }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sse(invalid))
      .mockResolvedValueOnce(sse(deltaFrames(JSON.stringify(TURN))));
    vi.stubGlobal("fetch", fetchMock);
    const onReset = vi.fn();
    const { result } = await debateTurnStream(PARAMS, { onDelta: () => {}, onReset });
    expect(result).toEqual(TURN);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("accepts a provider that ignores stream:true and answers a normal completion", async () => {
    const plain = new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(TURN) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(plain));
    const deltas: string[] = [];
    const { result } = await debateTurnStream(PARAMS, { onDelta: (t) => deltas.push(t), onReset: () => {} });
    expect(result).toEqual(TURN);
    expect(deltas.join("")).toBe(TURN.aiMessage);
  });

  it("surfaces a provider error event inside the stream as a failure", async () => {
    const errored = [`data: ${JSON.stringify({ error: { message: "upstream overloaded" } })}\n\n`];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(sse(errored)).mockResolvedValueOnce(sse(errored)),
    );
    vi.stubEnv("OPENROUTER_MAX_ATTEMPTS", "1");
    await expect(debateTurnStream(PARAMS, { onDelta: () => {}, onReset: () => {} })).rejects.toThrow(/All AI providers failed/);
  });

  it("does not let a throwing display callback break generation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(deltaFrames(JSON.stringify(TURN)))));
    const { result } = await debateTurnStream(PARAMS, {
      onDelta: () => {
        throw new Error("client stream closed");
      },
      onReset: () => {},
    });
    expect(result).toEqual(TURN);
  });

  it("streams the E2E mock word by word when the mock is armed", async () => {
    vi.stubEnv("E2E_MOCK_AI", "1");
    vi.stubEnv("E2E_MOCK_STREAM_DELAY_MS", "0");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    const { result, servedBy } = await debateTurnStream(PARAMS, { onDelta: (t) => deltas.push(t), onReset: () => {} });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(servedBy.provider).toBe("e2e-mock");
    expect(deltas.length).toBeGreaterThan(5);
    expect(deltas.join("")).toBe(result.aiMessage);
  });
});
