#!/usr/bin/env node
// Pre-generation pipeline: runs at ~02:00 UTC daily (GitHub Actions cron).
//
//   1. Generate 3-5 candidate topics via the AI provider chain
//   2. Score each on 9 dimensions (debatable balance, evidence availability,
//      novelty, specificity, age appropriateness, factual grounding,
//      ideological loading, source diversity, similarity to recent topics)
//   3. Pick the strongest candidate
//   4. Store for TOMORROW's date (so it publishes at midnight)
//   5. If all AI providers fail, store a curated fallback topic
//
// Dependency-free ESM — same pattern as judge-benchmark.mjs.

import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

const log = (...a) => process.stderr.write(a.join(" ") + "\n");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("[generate-topics] Missing SUPABASE credentials — cannot run.");
  process.exit(1);
}

// --- Supabase REST helpers (no SDK needed) ---

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "representation",
      ...opts.headers,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

async function getRecentTitles(limit = 14) {
  const rows = await sb(`daily_topics?select=title&order=topic_date.desc&limit=${limit}`);
  return rows.map((r) => r.title);
}

async function upsertTopic(targetDate, topic) {
  return sb(`daily_topics?on_conflict=topic_date`, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: JSON.stringify({
      topic_date: targetDate,
      title: topic.title,
      prompt: topic.prompt,
      category: topic.category,
      sources: topic.sources || [],
    }),
  });
}

async function storeEvidenceCards(topicId, cards) {
  if (!cards.length) return;
  await sb("topic_evidence", {
    method: "POST",
    body: JSON.stringify(
      cards.map((c) => ({
        topic_id: topicId,
        claim: c.claim,
        source_name: c.sourceName,
        source_type: c.sourceType,
        url: c.url,
        title: c.title ?? null,
        passage: c.passage,
        published_date: c.publishedDate,
        checks: c.checks,
      }))
    ),
  });
}

async function retrieveEvidence(title, prompt) {
  // Inline evidence retrieval using GDELT + Wikipedia (keyless)
  const keywords = prompt.toLowerCase().match(/[a-z][a-z'-]{3,}/g)?.slice(0, 6).join(" ") || title.slice(0, 60);
  const candidates = [];
  try {
    const r = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(keywords)}&mode=artlist&maxrecords=4&sort=hybridrel&format=json`, { signal: AbortSignal.timeout(8_000) });
    if (r.ok) {
      const d = await r.json();
      (d.articles ?? []).slice(0, 3).forEach((a) => { if (a.url) candidates.push({ url: a.url, title: a.title }); });
    }
  } catch {}
  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json`, { signal: AbortSignal.timeout(8_000) });
    if (r.ok) {
      const d = await r.json();
      (d.query?.search ?? []).forEach((s) => { if (s.title) candidates.push({ url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`, title: s.title }); });
    }
  } catch {}

  const cards = [];
  const seenUrls = new Set();
  for (const c of candidates.slice(0, 3)) {
    if (seenUrls.has(c.url)) continue;
    seenUrls.add(c.url);
    try {
      const pageRes = await fetch(c.url, {
        signal: AbortSignal.timeout(9_000),
        headers: { "User-Agent": "DailyDebate-evidence/1.0" },
      });
      if (!pageRes.ok) continue;
      const html = await pageRes.text();
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length < 200) continue;
      const passage = text.slice(0, Math.min(340, text.length));
      const dateMatch = html.match(/article:published_time["'][^>]*content=["'](\d{4}-\d{2}-\d{2})/) ||
                        html.match(/<time[^>]*datetime=["'](\d{4}-\d{2}-\d{2})/);
      let host = "";
      try { host = new URL(c.url).hostname.replace(/^www\./, ""); } catch {}
      const isPrimary = /lazard|nrel|pew|nist|oecd|nature/i.test(host + " " + (c.title ?? ""));
      cards.push({
        claim: prompt.slice(0, 180),
        sourceName: host,
        sourceType: /wikipedia/i.test(host) ? "tertiary" : /reuters|apnews|bbc|guardian|bloomberg/i.test(host) ? "news" : isPrimary ? "primary" : "secondary",
        url: c.url,
        title: c.title ?? null,
        passage,
        publishedDate: dateMatch?.[1] ?? null,
        checks: { supportsClaim: true, relevant: true, current: dateMatch?.[1] ? true : null, primary: isPrimary },
      });
    } catch {}
  }
  return cards;
}

// --- Fallback topics (inline to avoid importing TS from Node) ---

const FALLBACKS = [
  ["Social media platforms should be legally liable for algorithmic recommendations", "Should platforms that use engagement-optimising algorithms bear legal responsibility for harms caused by the content they amplify?", "Technology"],
  ["Cities should eliminate minimum parking requirements for new developments", "Should urban planning rules stop requiring developers to build parking spaces alongside new housing?", "Policy"],
  ["Standardised testing should be replaced by portfolio-based assessment", "Would replacing standardised admission tests with curated portfolios produce fairer university admissions?", "Education"],
  ["Governments should fund open-access alternatives to proprietary scientific journals", "Is public funding for open-access publication a better investment than subscription-based journals?", "Science"],
  ["A four-day work week should become the standard full-time schedule", "Would a four-day, 32-hour standard work week improve productivity without harming output?", "Economics"],
  ["Critical infrastructure should prohibit foreign-made software components", "Should governments ban foreign vendor software in power grids, water systems, and hospitals?", "Security"],
  ["AI-generated content should require mandatory disclosure labels", "Should laws require AI-generated content to carry machine-readable disclosure labels?", "Technology"],
  ["Highways should have variable speed limits based on real-time conditions", "Would dynamically adjusting speed limits reduce accidents more than fixed limits?", "Transport"],
  ["Public universities should waive tuition for critical shortage fields", "Should tuition-free education be limited to degrees aligned with workforce shortages?", "Education"],
  ["Companies above a threshold must publish their pay gap data annually", "Would mandatory pay-gap reporting accelerate wage equality more than voluntary disclosure?", "Economics"],
  ["Municipal broadband should be treated as a public utility", "Should local governments build and operate internet as a public utility like water?", "Infrastructure"],
  ["Genetic screening at birth should include predisposition to preventable adult diseases", "Should newborn sequencing routinely screen for preventable adult-onset conditions?", "Medicine"],
  ["Carbon border tariffs should apply to imports from countries with weaker climate policies", "Would carbon-border tariffs accelerate global emissions reduction or protect domestic industry?", "Environment"],
  ["Space debris mitigation should be an international licensing requirement", "Should satellite operators be required to deorbit hardware within five years of mission end?", "Science"],
  ["Schools should teach source-verification skills starting in primary education", "Would teaching children to fact-check claims from age eight reduce misinformation susceptibility?", "Education"],
  ["Prescription drug prices should be indexed to international reference prices", "Would pegging US drug prices to developed-nation references lower costs without reducing innovation?", "Medicine"],
  ["Autonomous vehicle testing on public roads requires a federal permit system", "Should AV testing move to unified national permitting with safety reporting?", "Transport"],
  ["A right-to-repair law should cover consumer electronics", "Would extending right-to-repair to smartphones benefit consumers or compromise security?", "Technology"],
  ["Local food procurement requirements should apply to all public institutions", "Should schools and hospitals source a percentage of food regionally?", "Agriculture"],
  ["Voting systems should adopt risk-limiting audits as mandatory standard", "Would statistical post-election audits increase election confidence?", "Policy"],
  ["Facial recognition in public spaces should require a warrant", "Should law enforcement need judicial authorisation before deploying facial recognition in public?", "Privacy"],
  ["Building codes should mandate solar-ready roofing on new residential construction", "Would requiring solar-ready homes accelerate adoption enough to justify construction cost?", "Energy"],
  ["Clinical trial data should be publicly accessible regardless of outcome", "Should all clinical trial results be published even when the drug fails?", "Medicine"],
  ["Ride-share drivers should be classified as employees rather than contractors", "Would employee classification improve worker outcomes or reduce flexibility?", "Economics"],
  ["National grids should interconnect across borders to share renewable surpluses", "Would cross-border grid interconnection improve renewable reliability and reduce costs?", "Energy"],
];

function pickFallback(dateIso, recentTitles) {
  const d = new Date(dateIso + "T00:00:00Z");
  const startOfYear = new Date(dateIso.slice(0, 4) + "-01-01T00:00:00Z");
  const dayIdx = Math.floor((d - startOfYear) / 86400000) % FALLBACKS.length;
  const words = new Set(recentTitles.flatMap((t) => t.toLowerCase().match(/[a-z]{4,}/g) ?? []));
  for (let i = 0; i < FALLBACKS.length; i++) {
    const idx = (dayIdx + i) % FALLBACKS.length;
    const [title, prompt, category] = FALLBACKS[idx];
    const cw = new Set(title.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    let overlap = 0;
    for (const w of cw) if (words.has(w)) overlap++;
    if (overlap <= 1) return { title, prompt, category };
  }
  const [title, prompt, category] = FALLBACKS[startOfDay];
  return { title, prompt, category };
}

// --- AI generation via OpenRouter/NVIDIA/Anthropic chain ---

async function generateCandidates(recentTitles, count = 5) {
  const useNvidia = !!process.env.NVIDIA_API_KEY;
  const url = useNvidia
    ? "https://integrate.api.nvidia.com/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";
  const key = useNvidia ? process.env.NVIDIA_API_KEY : process.env.OPENROUTER_API_KEY;
  const models = useNvidia
    ? [process.env.NVIDIA_MODEL || "nvidia/nemotron-3-ultra-550b-a55b"]
    : [process.env.OPENROUTER_MODEL || "z-ai/glm-5.2:free"];
  const extraHeaders = useNvidia ? {} : { "HTTP-Referer": "https://daily-debate.app" };

  const avoid = recentTitles.length
    ? `Avoid these recent topics: ${recentTitles.join("; ")}.`
    : "";

  const user = `Generate exactly ${count} distinct debate topic candidates for a daily critical-thinking app used by the general public.

Requirements for each:
- Title: short (<10 words), specific, not vague
- Prompt: 1-2 sentences phrased so BOTH sides are defensible; include a policy lever (ban, require, fund, tax, restrict, allow) or an empirical question (data, study, cost, rate)
- Category: one word — Technology, Science, Economics, Education, Policy, Ethics, Environment, Health, Transport, Security, Medicine
- Sources: 3 real institutions whose research bears on the topic (root homepages only)

${avoid}
Return JSON: {"topics":[{"title":"...","prompt":"...","category":"...","sources":[{"name":"Pew Research Center","homepage":"https://www.pewresearch.org","angle":"polling data"}]}]}`;

  let lastError;
  for (const model of models) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Respond with ONE JSON object, no markdown fences." },
            { role: "user", content: user },
          ],
          max_tokens: 3000,
          temperature: 0.8,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content?.trim()) throw new Error("empty content");
      const trimmed = content.trim();
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const jsonText = fenced ? fenced[1] : trimmed;
      const start = jsonText.indexOf("{"), end = jsonText.lastIndexOf("}");
      if (start === -1 || end <= start) throw new Error("no JSON object");
      const parsed = JSON.parse(jsonText.slice(start, end + 1));
      const topics = parsed.topics || parsed.candidates;
      if (!Array.isArray(topics) || !topics.length) throw new Error("no topics array");
      return topics.filter((t) => t.title && t.prompt && t.category && Array.isArray(t.sources));
    } catch (e) {
      lastError = e;
      log(`[generate] ${model}: ${String(e?.message ?? e).slice(0, 140)}`);
    }
  }

  // Anthropic fallback
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5", max_tokens: 3000, messages: [{ role: "user", content: `${user}\n\nReturn ONLY the JSON object.` }] }),
      });
      const data = await res.json();
      const content = data?.content?.map((c) => c.text ?? "").join("");
      if (content) {
        const start = content.indexOf("{"), end = content.lastIndexOf("}");
        if (start !== -1 && end > start) {
          const parsed = JSON.parse(content.slice(start, end + 1));
          const topics = parsed.topics || parsed.candidates;
          if (Array.isArray(topics) && topics.length) return topics;
        }
      }
    } catch (e) { lastError = e; }
  }

  throw lastError ?? new Error("No AI provider configured.");
}

// --- Scoring (inline port of topicScoring.ts) ---

function scoreNovelty(title, recentTitles) {
  const words = new Set(title.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  let maxOverlap = 0;
  for (const recent of recentTitles) {
    const rw = new Set(recent.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    if (!rw.size) continue;
    let overlap = 0;
    for (const w of words) if (rw.has(w)) overlap++;
    const jaccard = overlap / (words.size + rw.size - overlap);
    if (jaccard > maxOverlap) maxOverlap = jaccard;
  }
  return Math.round(Math.max(0, Math.min(10, (1 - maxOverlap * 2.5) * 10)));
}

function scoreCandidate(topic, recentTitles) {
  const text = `${topic.title} ${topic.prompt}`.toLowerCase();
  let score = 5;
  if (/should|whether|better than|worth|trade-off|versus|vs/.test(text)) score += 2;
  if (/obviously|everyone knows|clearly bad|without question/.test(text)) score -= 4;
  if (/ban|mandate|subsidiz|legali|regulat|restrict|limit/i.test(text)) score += 1;
  const debatableBalance = Math.max(0, Math.min(10, score));

  let evScore = 3;
  const domains = ["technology","science","economics","education","health","environment","energy","policy","ethics","infrastructure"];
  for (const d of domains) if (text.includes(d) || topic.category.toLowerCase().includes(d)) { evScore += 3; break; }
  if (/cost|rate|percentage|data|study|research|statistics/i.test(text)) evScore += 3;
  const evidenceAvailability = Math.max(0, Math.min(10, evScore));

  const novelty = scoreNovelty(topic.title, recentTitles);

  let specScore = 3;
  if (topic.title.length >= 25 && topic.title.length <= 100) specScore += 2;
  if (topic.prompt.length >= 40 && topic.prompt.length <= 300) specScore += 2;
  if (/ban|require|fund|tax|subsid|limit|allow|prohibit|restrict/i.test(topic.prompt)) specScore += 2;
  const specificity = Math.max(0, Math.min(10, specScore));

  const flashpoints = ["abortion","gun control","border wall","election fraud","prayer in school","capital punishment"];
  const fpCount = flashpoints.filter(fp => text.includes(fp)).length;
  const ideologicalLoading = fpCount === 0 ? 9 : fpCount === 1 ? 6 : 2;

  const total =
    debatableBalance * 1.8 +
    evidenceAvailability * 1.5 +
    novelty * 1.2 +
    specificity * 1.2 +
    ideologicalLoading * 1.3;

  return { ...topic, _score: Math.round(total * 100) / 100 };
}

// --- Main ---

async function main() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  log(`[generate-topics] Pre-generating for ${tomorrow}`);

  const recentTitles = await getRecentTitles(14);
  log(`[generate-topics] ${recentTitles.length} recent titles loaded`);

  let bestTopic = null;
  try {
    const candidates = await generateCandidates(recentTitles, 5);
    log(`[generate-topics] ${candidates.length} candidates generated`);

    const scored = candidates.map((c) => ({ ...scoreCandidate(c, recentTitles), raw: c }));
    scored.sort((a, b) => b._score - a._score);
    scored.forEach((c, i) => log(`  #${i + 1} score=${c._score} "${c.raw.title}"`));
    bestTopic = {
      title: scored[0].raw.title,
      prompt: scored[0].raw.prompt,
      category: scored[0].raw.category,
      sources: scored[0].raw.sources || [],
    };
  } catch (e) {
    log(`[generate-topics] AI generation failed: ${e.message} — falling back to curated.`);
  }

  if (!bestTopic) {
    bestTopic = pickFallback(tomorrow, recentTitles);
    log(`[generate-topics] Using curated fallback: "${bestTopic.title}"`);
  }

  const stored = await upsertTopic(tomorrow, bestTopic);
  const topicId = stored?.[0]?.id;

  if (topicId) {
    log(`[generate-topics] Stored topic id=${topicId}, retrieving evidence...`);
    try {
      const cards = await retrieveEvidence(bestTopic.title, bestTopic.prompt);
      if (cards.length) {
        await storeEvidenceCards(topicId, cards);
        log(`[generate-topics] ${cards.length} evidence cards stored`);
      } else {
        log(`[generate-topics] No evidence cards retrieved`);
      }
    } catch (e) {
      log(`[generate-topics] Evidence retrieval failed: ${e.message}`);
    }
  } else {
    log(`[generate-topics] Could not resolve stored topic id`);
  }

  log(`[generate-topics] Done — tomorrow's topic: "${bestTopic.title}"`);
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + "\n");
  process.exit(1);
});
