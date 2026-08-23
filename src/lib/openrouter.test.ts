import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FALLBACK_MODELS,
  DEFAULT_MODEL,
  extractJson,
  generateDailyTopic,
  modelChain,
} from "./openrouter";

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

describe("modelChain", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to free GLM 5.2 ahead of the measured fallbacks", () => {
    expect(DEFAULT_MODEL).toBe("z-ai/glm-5.2:free");
    expect(modelChain()).toEqual([DEFAULT_MODEL, ...DEFAULT_FALLBACK_MODELS]);
  });

  it("honours an OPENROUTER_MODEL override as the primary", () => {
    vi.stubEnv("OPENROUTER_MODEL", "some/other-model");
    expect(modelChain()[0]).toBe("some/other-model");
  });

  it("never lists the primary twice when it also appears in the fallbacks", () => {
    vi.stubEnv("OPENROUTER_MODEL", DEFAULT_FALLBACK_MODELS[0]);
    const chain = modelChain();
    expect(chain[0]).toBe(DEFAULT_FALLBACK_MODELS[0]);
    expect(chain.filter((m) => m === DEFAULT_FALLBACK_MODELS[0])).toHaveLength(1);
  });

  it("pins to a single model when the fallback list is set empty", () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODELS", "");
    expect(modelChain()).toEqual([DEFAULT_MODEL]);
  });

  it("accepts a custom comma-separated fallback list", () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODELS", " a/one , b/two ");
    expect(modelChain()).toEqual([DEFAULT_MODEL, "a/one", "b/two"]);
  });
});

// --- transport behaviour ---------------------------------------------------

function okResponse(content: string | null, finishReason = "stop") {
  return new Response(
    JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }),
    { status: 200 },
  );
}

function errorResponse(status: number, raw: string) {
  return new Response(JSON.stringify({ error: { code: status, metadata: { raw }, message: raw } }), {
    status,
  });
}

const rateLimited = () => errorResponse(429, "temporarily rate-limited upstream");

const TOPIC = JSON.stringify({
  title: "Ban cars downtown",
  prompt: "Should large cities ban private cars from their centres?",
  category: "Policy",
  sources: [{ name: "ITF", homepage: "https://www.itf-oecd.org", angle: "Urban mobility data." }],
});

describe("generateDailyTopic transport", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
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
    void done.then(() => {
      settled = true;
    });
    while (!settled) {
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
    }
    const r = await done;
    if (!r.ok) throw r.e;
    return r.v;
  }

  const modelOf = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body).model;

  describe("with failover disabled", () => {
    beforeEach(() => vi.stubEnv("OPENROUTER_FALLBACK_MODELS", ""));

    it("retries an upstream 429 and returns the eventual success", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(rateLimited())
        .mockResolvedValueOnce(rateLimited())
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
      const fetchMock = vi.fn().mockImplementation(async () => rateLimited());
      vi.stubGlobal("fetch", fetchMock);

      await expect(settle(generateDailyTopic([]))).rejects.toThrow(/temporarily rate-limited upstream/);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("does not retry a non-429 client error", async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(async () => errorResponse(404, "No endpoints available"));
      vi.stubGlobal("fetch", fetchMock);

      await expect(settle(generateDailyTopic([]))).rejects.toThrow(/No endpoints available/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("sends the configured model, json_object mode, and reasoning disabled", async () => {
      vi.stubEnv("OPENROUTER_MODEL", "z-ai/glm-5.2:free");
      const fetchMock = vi.fn().mockResolvedValue(okResponse(TOPIC));
      vi.stubGlobal("fetch", fetchMock);

      await settle(generateDailyTopic(["Yesterday topic"]));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.model).toBe("z-ai/glm-5.2:free");
      expect(body.response_format).toEqual({ type: "json_object" });
      // GLM 5.2 spends ~90% of completion tokens reasoning if left enabled.
      expect(body.reasoning).toEqual({ enabled: false });
      expect(body.messages[1].content).toContain("Yesterday topic");
    });

    it("retries without the reasoning flag when the endpoint requires reasoning", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          errorResponse(400, "Reasoning is mandatory for this endpoint and cannot be disabled."),
        )
        .mockResolvedValueOnce(okResponse(TOPIC));
      vi.stubGlobal("fetch", fetchMock);

      const topic = await settle(generateDailyTopic([]));

      expect(topic.title).toBe("Ban cars downtown");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).reasoning).toEqual({
        enabled: false,
      });
      expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).not.toHaveProperty("reasoning");
    });

    it("explains a budget exhausted by reasoning tokens", async () => {
      // Reasoning models return a null content with finish_reason "length"
      // when thinking consumes the whole allowance.
      const fetchMock = vi.fn().mockImplementation(async () => okResponse(null, "length"));
      vi.stubGlobal("fetch", fetchMock);

      await expect(settle(generateDailyTopic([]))).rejects.toThrow(
        /hit the \d+-token limit before emitting any content/,
      );
    });

    it("flags truncation when the JSON is cut off at max_tokens", async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(async () => okResponse('{"title":"Ban ca', "length"));
      vi.stubGlobal("fetch", fetchMock);

      await expect(settle(generateDailyTopic([]))).rejects.toThrow(/truncated at max_tokens/);
    });

    it("fails fast and clearly when the key is absent", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "");
      await expect(generateDailyTopic([])).rejects.toThrow("OPENROUTER_API_KEY is not configured.");
    });
  });

  describe("model failover", () => {
    it("falls through to the next model when the primary pool is saturated", async () => {
      const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
        return JSON.parse(init.body).model === DEFAULT_MODEL ? rateLimited() : okResponse(TOPIC);
      });
      vi.stubGlobal("fetch", fetchMock);

      const topic = await settle(generateDailyTopic([]));

      expect(topic.title).toBe("Ban cars downtown");
      const tried = fetchMock.mock.calls.map(modelOf);
      expect(tried[0]).toBe(DEFAULT_MODEL);
      expect(tried).toContain(DEFAULT_FALLBACK_MODELS[0]);
    });

    it("moves on rather than exhausting retries on a saturated primary", async () => {
      const fetchMock = vi.fn().mockImplementation(async () => rateLimited());
      vi.stubGlobal("fetch", fetchMock);

      await expect(settle(generateDailyTopic([]))).rejects.toThrow(/Tried 3/);

      const perModel = fetchMock.mock.calls.map(modelOf).reduce<Record<string, number>>((acc, m) => {
        acc[m] = (acc[m] ?? 0) + 1;
        return acc;
      }, {});
      // Only the last model in the chain gets the full attempt allowance.
      expect(perModel[DEFAULT_MODEL]).toBe(2);
      expect(perModel[DEFAULT_FALLBACK_MODELS[0]]).toBe(2);
      expect(perModel[DEFAULT_FALLBACK_MODELS[1]]).toBe(4);
    });

    it("falls through when a model is unavailable to the account", async () => {
      const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
        return JSON.parse(init.body).model === DEFAULT_MODEL
          ? errorResponse(403, "only available on agentic harnesses")
          : okResponse(TOPIC);
      });
      vi.stubGlobal("fetch", fetchMock);

      const topic = await settle(generateDailyTopic([]));
      expect(topic.category).toBe("Policy");
      // A 403 is fatal for that model, so exactly one call before moving on.
      expect(fetchMock.mock.calls.filter((c) => modelOf(c) === DEFAULT_MODEL)).toHaveLength(1);
    });

    it("names every model it tried when all of them fail", async () => {
      const fetchMock = vi.fn().mockImplementation(async () => errorResponse(404, "no endpoints"));
      vi.stubGlobal("fetch", fetchMock);

      const caught = await settle(generateDailyTopic([]).then(() => null, (e: Error) => e));
      const message = caught?.message ?? "";
      expect(message).toContain(DEFAULT_MODEL);
      expect(message).toContain(DEFAULT_FALLBACK_MODELS[0]);
      expect(message).toContain(DEFAULT_FALLBACK_MODELS[1]);
    });
  });
});
