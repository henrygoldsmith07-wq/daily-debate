// Sanitises Gemini-generated daily topics before they are persisted. A bad
// topic sticks around all day (topic_date is unique), so validate defensively:
// clamp text lengths, normalise homepages to real https roots, dedupe and cap
// sources. Pure — unit-tested.

import type { GeneratedTopic } from "./gemini";
import type { TopicSource } from "./types";

function clamp(value: unknown, maxLen: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLen) : "";
}

/** Normalise to a bare https root (origin only). Returns null when unusable. */
export function normaliseHomepage(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim().includes("://") ? raw.trim() : `https://${raw.trim()}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.protocol = "https:";
    return url.origin;
  } catch {
    return null;
  }
}

export function sanitizeGeneratedTopic(generated: GeneratedTopic | null | undefined): GeneratedTopic {
  const title = clamp(generated?.title, 140) || "Today's debate";
  const prompt = clamp(generated?.prompt, 500) || "Should the proposal be supported?";
  const category = clamp(generated?.category, 40) || "General";

  const seen = new Set<string>();
  const sources: TopicSource[] = [];
  for (const s of Array.isArray(generated?.sources) ? generated.sources : []) {
    if (!s || typeof s !== "object") continue;
    const name = clamp((s as Partial<TopicSource>).name, 80);
    const homepage = normaliseHomepage((s as Partial<TopicSource>).homepage);
    const angle = clamp((s as Partial<TopicSource>).angle, 300);
    if (!name || !homepage) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ name, homepage, angle });
    if (sources.length >= 5) break;
  }

  return { title, prompt, category, sources };
}
