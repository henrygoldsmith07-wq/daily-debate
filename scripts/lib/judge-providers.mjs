// Provider adapters for the live judge benchmark: NVIDIA (direct) with model
// failover, OpenRouter free tier, and Anthropic.

function extractJson(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in output");
  return JSON.parse(candidate.slice(start, end + 1));
}

const VERDICT_SYSTEM =
  "You are a neutral debate judge. Analyse argument structure only. Respond with ONE JSON object, no prose.";

export function verdictUser(transcript) {
  return `Debate transcript (Player A vs Player B):\n\n${transcript}\n\nScore both sides 0-100 on observable argument quality (grounded claims, rebuttals, impact weighing). Decide the winner strictly on that structure.\nReturn JSON exactly: {"winner":"a|b|tie","playerAScore":<int>,"playerBScore":<int>,"confidence":<0..1>}`;
}

function normaliseVerdict(parsed) {
  const winner = ["a", "b", "tie"].includes(parsed.winner) ? parsed.winner : "tie";
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  return {
    winner,
    a: clamp(parsed.playerAScore),
    b: clamp(parsed.playerBScore),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
  };
}

async function chat({ url, key, model, system, user, maxTokens, extraHeaders = {} }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${bodyText.slice(0, 160)}`);
    const data = JSON.parse(bodyText);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("empty content");
    return { content, tokens: data?.usage?.total_tokens ?? null };
  } finally {
    clearTimeout(timer);
  }
}

/** NVIDIA/OpenRouter chain judge: tries each model in order. */
function makeChainJudge({ url, key, models, extraHeaders = {} }) {
  return async (transcript) => {
    let lastError;
    for (const model of models) {
      try {
        const { content, tokens } = await chat({
          url, key, model, system: VERDICT_SYSTEM, user: verdictUser(transcript), maxTokens: 900, extraHeaders,
        });
        return { ...normaliseVerdict(extractJson(content)), model, tokens };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError ?? new Error("no models configured");
  };
}

export function primaryChainJudge(env = process.env) {
  if (env.NVIDIA_API_KEY) {
    const models = [env.NVIDIA_MODEL || "nvidia/nemotron-3-ultra-550b-a55b"];
    if (env.ALL_MODELS && env.NVIDIA_FALLBACK_MODELS) models.push(...env.NVIDIA_FALLBACK_MODELS.split(",").map((m) => m.trim()).filter(Boolean));
    else if (!env.ALL_MODELS && env.NVIDIA_FALLBACK_MODELS) models.push(...env.NVIDIA_FALLBACK_MODELS.split(",").map((m) => m.trim()).filter(Boolean).slice(0, 0));
    return { id: `nvidia:${models.join("/")}`, fn: makeChainJudge({ url: "https://integrate.api.nvidia.com/v1/chat/completions", key: env.NVIDIA_API_KEY, models }) };
  }
  if (env.OPENROUTER_API_KEY) {
    const models = [env.OPENROUTER_MODEL || "z-ai/glm-5.2:free"];
    if (env.OPENROUTER_FALLBACK_MODELS) models.push(...env.OPENROUTER_FALLBACK_MODELS.split(",").map((m) => m.trim()).filter(Boolean));
    return { id: `openrouter:${models[0]}`, fn: makeChainJudge({ url: "https://openrouter.ai/api/v1/chat/completions", key: env.OPENROUTER_API_KEY, models, extraHeaders: { "HTTP-Referer": "https://daily-debate.app" } }) };
  }
  return null;
}

export function anthropicJudge(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const model = env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const fn = async (transcript) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 900, messages: [{ role: "user", content: `${VERDICT_SYSTEM}\n\n${verdictUser(transcript)}` }] }),
    });
    const data = await res.json();
    const content = data?.content?.map((c) => c.text ?? "").join("");
    if (!res.ok || !content) throw new Error(`anthropic ${res.status}`);
    return { ...normaliseVerdict(extractJson(content)), model, tokens: data.usage ? (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) : null };
  };
  return { id: `anthropic:${model}`, fn };
}
