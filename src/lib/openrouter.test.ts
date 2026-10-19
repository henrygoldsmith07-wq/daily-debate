import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Transport tests stub fetch; telemetry must not mirror their fake calls into a
// real ai_call_log when DATABASE_URL is set (the CI e2e job runs unit tests
// against Postgres, and the DB suites' migration replay rejects provider labels
// newer than migration 011).
vi.mock("./aiTelemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./aiTelemetry")>()),
  recordAiCall: vi.fn(),
}));
import {
  DEFAULT_FALLBACK_MODELS,
  DEFAULT_MODEL,
  PROVIDERS,
  __clearCooldownsForTests,
  configuredProviders,
  extractJson,
  failoverChain,
  generateDailyTopic,
  judgePvpMatch,
  modelChainFor,
  type ProviderLabel,
} from "./openrouter";

const ALL_KEYS = PROVIDERS.map((p) => p.keyEnv);
const spec = (label: ProviderLabel) => PROVIDERS.find((p) => p.label === label)!;
/** Start every registry case from "no provider keyed", whatever the host env holds. */
function clearKeys() {
  for (const k of ALL_KEYS) vi.stubEnv(k, "");
}

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

describe("modelChainFor", () => {
  afterEach(() => vi.unstubAllEnvs());
  const openrouter = () => spec("openrouter");

  it("defaults to the reliably-fast free Nemotron 3 Super ahead of the measured fallbacks", () => {
    expect(DEFAULT_MODEL).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    expect(modelChainFor(openrouter())).toEqual([DEFAULT_MODEL, ...DEFAULT_FALLBACK_MODELS]);
  });

  it("honours an OPENROUTER_MODEL override as the primary", () => {
    vi.stubEnv("OPENROUTER_MODEL", "some/other-model");
    expect(modelChainFor(openrouter())[0]).toBe("some/other-model");
  });

  it("never lists the primary twice when it also appears in the fallbacks", () => {
    vi.stubEnv("OPENROUTER_MODEL", DEFAULT_FALLBACK_MODELS[0]);
    const chain = modelChainFor(openrouter());
    expect(chain[0]).toBe(DEFAULT_FALLBACK_MODELS[0]);
    expect(chain.filter((m) => m === DEFAULT_FALLBACK_MODELS[0])).toHaveLength(1);
  });

  it("pins to a single model when the fallback list is set empty", () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODELS", "");
    expect(modelChainFor(openrouter())).toEqual([DEFAULT_MODEL]);
  });

  it("accepts a custom comma-separated fallback list", () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODELS", " a/one , b/two ");
    expect(modelChainFor(openrouter())).toEqual([DEFAULT_MODEL, "a/one", "b/two"]);
  });

  it("uses per-provider defaults and override envs", () => {
    expect(modelChainFor(spec("groq"))).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
    expect(modelChainFor(spec("cerebras"))).toEqual(["gpt-oss-120b"]);
    expect(modelChainFor(spec("gemini"))).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    vi.stubEnv("GROQ_MODEL", "custom/model");
    vi.stubEnv("GROQ_FALLBACK_MODELS", "a/x,b/y");
    expect(modelChainFor(spec("groq"))).toEqual(["custom/model", "a/x", "b/y"]);
  });
});

describe("provider registry", () => {
  beforeEach(clearKeys);
  afterEach(() => vi.unstubAllEnvs());

  it("has no paid provider and no retired one", () => {
    expect(PROVIDERS.map((p) => p.label)).toEqual(["unorouter", "groq", "cerebras", "gemini", "nvidia", "openrouter"]);
  });

  it("orders measured-good, then unmeasured, then measured-bad", () => {
    // UnoRouter 278/312 clears providerReliabilityMin; OpenRouter's free pool
    // 72/300 does not, so it is tried last; unmeasured transports sit between.
    for (const k of ALL_KEYS) vi.stubEnv(k, "k");
    const order = configuredProviders().map((p) => p.label);
    expect(order[0]).toBe("unorouter");
    expect(order[order.length - 1]).toBe("openrouter");
  });

  it("serves keyed providers in every environment — there is no production gate any more", () => {
    vi.stubEnv("GROQ_API_KEY", "g");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("JUDGE_ALLOW_FREE_PROVIDERS", "");
    expect(configuredProviders().map((p) => p.label)).toEqual(["groq", "openrouter"]);
  });

  it("removes a keyed provider with <LABEL>_DISABLED=1", () => {
    vi.stubEnv("GROQ_API_KEY", "g");
    vi.stubEnv("GEMINI_API_KEY", "m");
    vi.stubEnv("GROQ_DISABLED", "1");
    expect(configuredProviders().map((p) => p.label)).toEqual(["gemini"]);
  });

  it("flattens every provider's model chain into one failover chain, in order", () => {
    vi.stubEnv("CEREBRAS_API_KEY", "c");
    vi.stubEnv("GEMINI_API_KEY", "m");
    expect(failoverChain().map((s) => `${s.provider.label}:${s.model}`)).toEqual([
      "cerebras:gpt-oss-120b",
      "gemini:gemini-3.8-flash",
      "gemini:gemini-3.5-flash-lite",
    ]);
    expect(failoverChain()[0].key).toBe("c");
  });

  it("is empty when nothing is configured", () => {
    expect(configuredProviders()).toEqual([]);
    expect(failoverChain()).toEqual([]);
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
    clearKeys();
    __clearCooldownsForTests();
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

    it("fails fast and clearly when no key is present", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "");
      await expect(generateDailyTopic([])).rejects.toThrow(/No AI provider configured/i);
    });

    it("retries without json_object mode when the endpoint rejects it", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(errorResponse(400, "response_format type json_object is not supported"))
        .mockResolvedValueOnce(okResponse(TOPIC));
      vi.stubGlobal("fetch", fetchMock);

      const topic = await settle(generateDailyTopic([]));

      expect(topic.title).toBe("Ban cars downtown");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).response_format).toEqual({ type: "json_object" });
      expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).not.toHaveProperty("response_format");
    });

    it("rejects a schema-invalid answer instead of returning it", async () => {
      const fetchMock = vi.fn().mockImplementation(async () => okResponse(JSON.stringify({ title: "x" })));
      vi.stubGlobal("fetch", fetchMock);

      await expect(settle(generateDailyTopic([]))).rejects.toThrow(/failed schema validation/);
    });
  });

  describe("cross-provider failover", () => {
    const urlOf = (call: unknown[]) => String(call[0]);

    it("skips a rate-limited provider on the next request until its cooldown passes", async () => {
      vi.stubEnv("UNOROUTER_API_KEY", "u");
      vi.stubEnv("UNOROUTER_FALLBACK_MODELS", "");
      const fetchMock = vi.fn().mockImplementation(async (url: string) =>
        url.includes("unorouter") ? errorResponse(429, "daily free limit reached") : okResponse(TOPIC),
      );
      vi.stubGlobal("fetch", fetchMock);
      const unoCalls = () => fetchMock.mock.calls.filter((c) => urlOf(c).includes("unorouter")).length;

      await settle(generateDailyTopic([]));
      const afterFirst = unoCalls();
      expect(afterFirst).toBeGreaterThan(0);

      // Second request: unorouter is cooling down, so it goes straight to OpenRouter.
      await settle(generateDailyTopic([]));
      expect(unoCalls()).toBe(afterFirst);

      // After the default 60s cooldown it is tried again.
      vi.advanceTimersByTime(61_000);
      await settle(generateDailyTopic([]));
      expect(unoCalls()).toBeGreaterThan(afterFirst);
    });

    it("honours a provider's Retry-After for the cooldown length", async () => {
      vi.stubEnv("UNOROUTER_API_KEY", "u");
      vi.stubEnv("UNOROUTER_FALLBACK_MODELS", "");
      const fetchMock = vi.fn().mockImplementation(async (url: string) =>
        url.includes("unorouter")
          ? new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429, headers: { "retry-after": "300" } })
          : okResponse(TOPIC),
      );
      vi.stubGlobal("fetch", fetchMock);
      const unoCalls = () => fetchMock.mock.calls.filter((c) => urlOf(c).includes("unorouter")).length;

      await settle(generateDailyTopic([]));
      const afterFirst = unoCalls();
      vi.advanceTimersByTime(120_000); // past the 60s default, inside the advised 300s
      await settle(generateDailyTopic([]));
      expect(unoCalls()).toBe(afterFirst);
    });

    it("still tries everything when every step is cooling down", async () => {
      vi.stubEnv("OPENROUTER_FALLBACK_MODELS", "");
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(async () => rateLimited())
        .mockImplementationOnce(async () => rateLimited())
        .mockImplementationOnce(async () => rateLimited())
        .mockImplementationOnce(async () => rateLimited())
        .mockImplementation(async () => okResponse(TOPIC));
      vi.stubGlobal("fetch", fetchMock);

      await expect(settle(generateDailyTopic([]))).rejects.toThrow(/rate-limited/);
      // The only step is cooling down; local memory must not refuse the call.
      const topic = await settle(generateDailyTopic([]));
      expect(topic.title).toBe("Ban cars downtown");
    });

    it("moves to the next provider when every model on the first fails", async () => {
      vi.stubEnv("UNOROUTER_API_KEY", "u");
      vi.stubEnv("UNOROUTER_FALLBACK_MODELS", "");
      const fetchMock = vi.fn().mockImplementation(async (url: string) =>
        url.includes("unorouter") ? errorResponse(404, "no endpoints") : okResponse(TOPIC),
      );
      vi.stubGlobal("fetch", fetchMock);

      const topic = await settle(generateDailyTopic([]));

      expect(topic.title).toBe("Ban cars downtown");
      expect(urlOf(fetchMock.mock.calls[0])).toContain("api.unorouter.com");
      expect(urlOf(fetchMock.mock.calls[1])).toContain("openrouter.ai");
    });

    it("skips the rest of a provider whose key is rejected", async () => {
      vi.stubEnv("GEMINI_API_KEY", "bad");
      const fetchMock = vi.fn().mockImplementation(async (url: string) =>
        url.includes("googleapis") ? errorResponse(401, "API key not valid") : okResponse(TOPIC),
      );
      vi.stubGlobal("fetch", fetchMock);

      await settle(generateDailyTopic([]));

      // gemini has two models, but a 401 means the key is bad for all of them.
      expect(fetchMock.mock.calls.filter((c) => urlOf(c).includes("googleapis"))).toHaveLength(1);
    });

    it("sends gpt-oss providers low reasoning effort and never the OpenRouter-only toggle", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "");
      vi.stubEnv("GROQ_API_KEY", "g");
      const fetchMock = vi.fn().mockResolvedValue(okResponse(TOPIC));
      vi.stubGlobal("fetch", fetchMock);

      await settle(generateDailyTopic([]));

      expect(urlOf(fetchMock.mock.calls[0])).toBe("https://api.groq.com/openai/v1/chat/completions");
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.model).toBe("openai/gpt-oss-120b");
      expect(body.reasoning_effort).toBe("low");
      expect(body).not.toHaveProperty("reasoning");
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer g");
    });

    it("stamps a verdict with the provider and model that actually served it", async () => {
      // CI's verify job runs with E2E_MOCK_AI=1, which short-circuits the judge
      // to the scripted mock; this case is about the live transport.
      vi.stubEnv("E2E_MOCK_AI", "");
      vi.stubEnv("UNOROUTER_API_KEY", "u");
      vi.stubEnv("UNOROUTER_FALLBACK_MODELS", "");
      vi.stubEnv("OPENROUTER_FALLBACK_MODELS", "");
      const graph = {
        rationale: "A answered B's claim directly.",
        argGraph: {
          nodes: [
            { id: "c1", kind: "claim", owner: "a", text: "Cars pollute city centres.", round: 1 },
            { id: "c2", kind: "claim", owner: "b", text: "Bans hurt local shops.", round: 1 },
          ],
          edges: [],
          dropped: [],
          contradictions: [],
          concessions: [],
          fallacies: [],
          evidenceStats: { total: 0, byOwner: { a: 0, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 0, strong: 0 }, unsupportedClaimIds: [] },
          impactComparison: { a: 0, b: 0, rationale: "even" },
        },
      };
      const fetchMock = vi.fn().mockImplementation(async (url: string) =>
        url.includes("unorouter") ? rateLimited() : okResponse(JSON.stringify(graph)),
      );
      vi.stubGlobal("fetch", fetchMock);

      const verdict = await settle(
        judgePvpMatch({ topicTitle: "Cars", topicPrompt: "Ban cars?", playerASide: "for", transcript: "A: x\nB: y" }),
      );

      expect(verdict.servedBy).toEqual({ provider: "openrouter", model: DEFAULT_MODEL });
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

      await expect(settle(generateDailyTopic([]))).rejects.toThrow(
        new RegExp(`Tried ${1 + DEFAULT_FALLBACK_MODELS.length}`),
      );

      const perModel = fetchMock.mock.calls.map(modelOf).reduce<Record<string, number>>((acc, m) => {
        acc[m] = (acc[m] ?? 0) + 1;
        return acc;
      }, {});
      // Only the last model in the chain gets the full attempt allowance.
      expect(perModel[DEFAULT_MODEL]).toBe(2);
      expect(perModel[DEFAULT_FALLBACK_MODELS[0]]).toBe(2);
      expect(perModel[DEFAULT_FALLBACK_MODELS[DEFAULT_FALLBACK_MODELS.length - 1]]).toBe(4);
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
