import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL, extractJson, generateDailyTopic } from "./openrouter";

// The free-tier models honour `json_object` mode inconsistently — they wrap
// output in fences, prepend "Here is the JSON:", or emit a reasoning preamble.
// extractJson is what stands between that and a 502, so pin the shapes we have
// actually observed.
describe("extractJson", () => {
  it("passes through clean JSON untouched", () => {
    expect(extractJson('{"title":"a"}')).toBe('{"title":"a"}');
  });

  it("trims surrounding whitespace", () => {
    expect(extractJson('\n\n  {"title":"a"}  \n')).toBe('{"title":"a"}');
  });

  it("unwraps a ```json fence", () => {
    expect(extractJson('```json\n{"title":"a"}\n```')).toBe('{"title":"a"}');
  });

  it("unwraps a bare ``` fence", () => {
    expect(extractJson('```\n{"title":"a"}\n```')).toBe('{"title":"a"}');
  });

  it("strips a prose preamble", () => {
    expect(extractJson('Here is the JSON:\n{"title":"a"}')).toBe('{"title":"a"}');
  });

  it("strips prose on both sides", () => {
    expect(extractJson('Sure!\n{"title":"a"}\nLet me know if you need more.')).toBe('{"title":"a"}');
  });

  it("keeps nested braces intact", () => {
    const nested = '{"a":{"b":[1,2]},"c":"}"}';
    expect(extractJson(`preamble ${nested}`)).toBe(nested);
  });

  it("handles a top-level array", () => {
    expect(extractJson('Here:\n[{"a":1}]')).toBe('[{"a":1}]');
  });

  it("returns the input unchanged when there is no JSON to find", () => {
    expect(extractJson("I cannot help with that.")).toBe("I cannot help with that.");
  });

  it("survives a fence that was never closed", () => {
    // Truncated generations (hit max_tokens mid-fence) still yield the object.
    expect(extractJson('```json\n{"title":"a"}')).toBe('{"title":"a"}');
  });
});

describe("DEFAULT_MODEL", () => {
  it("is the free GLM 5.2 pool", () => {
    expect(DEFAULT_MODEL).toBe("z-ai/glm-5.2:free");
  });
});

// --- transport behaviour ---------------------------------------------------

function okResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

function rateLimited(retryAfterSeconds?: number) {
  return new Response(
    JSON.stringify({
      error: {
        code: 429,
        metadata: { raw: "temporarily rate-limited upstream", retry_after_seconds: retryAfterSeconds },
      },
    }),
    { status: 429 },
  );
}

const TOPIC = JSON.stringify({
  title: "Ban cars downtown",
  prompt: "Should large cities ban private cars from their centres?",
  category: "Policy",
  sources: [{ name: "ITF", homepage: "https://www.itf-oecd.org", angle: "Urban mobility data." }],
});

describe("generateDailyTopic transport", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    // Keep backoff from making the suite slow.
    vi.stubEnv("OPENROUTER_MAX_ATTEMPTS", "4");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Runs `p` while auto-advancing timers so backoff sleeps resolve instantly. */
  async function settle<T>(p: Promise<T>): Promise<T> {
    const done = p.then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    );
    let settled = false;
    void done.then(() => { settled = true; });
    while (!settled) {
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
    }
    const r = await done;
    if (!r.ok) throw r.e;
    return r.v;
  }

  it("retries an upstream 429 and returns the eventual success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rateLimited(1))
      .mockResolvedValueOnce(rateLimited(1))
      .mockResolvedValueOnce(okResponse(TOPIC));
    vi.stubGlobal("fetch", fetchMock);

    const topic = await settle(generateDailyTopic([]));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(topic.title).toBe("Ban cars downtown");
    expect(topic.sources).toHaveLength(1);
  });

  it("unwraps a fenced response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(["```json", TOPIC, "```"].join("\n")));
    vi.stubGlobal("fetch", fetchMock);

    const topic = await settle(generateDailyTopic([]));
    expect(topic.category).toBe("Policy");
  });

  it("gives up after the attempt budget and reports the upstream reason", async () => {
    // A Response body reads once, so hand back a fresh one per call the way
    // real fetch does — otherwise later attempts see an unreadable body.
    const fetchMock = vi.fn().mockImplementation(async () => rateLimited(1));
    vi.stubGlobal("fetch", fetchMock);

    await expect(settle(generateDailyTopic([]))).rejects.toThrow(/temporarily rate-limited upstream/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry a non-429 client error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: "No endpoints available" } }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(settle(generateDailyTopic([]))).rejects.toThrow(/No endpoints available/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the configured model and a json_object response format", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "z-ai/glm-5.2:free");
    const fetchMock = vi.fn().mockResolvedValue(okResponse(TOPIC));
    vi.stubGlobal("fetch", fetchMock);

    await settle(generateDailyTopic(["Yesterday topic"]));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("z-ai/glm-5.2:free");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content).toContain("Yesterday topic");
  });

  it("fails fast and clearly when the key is absent", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(generateDailyTopic([])).rejects.toThrow("OPENROUTER_API_KEY is not configured.");
  });
});
