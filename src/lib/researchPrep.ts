// Research / preparation mode: let debaters gather sources before a match.
// Pure, offline. Surfaces as a timed pre-debate step and feeds into evidence.

import type { TopicSource } from "./types";

export interface PrepSource {
  name: string;
  homepage: string;
  angle: string;
  addedBy: "system" | "user";
  note?: string;
}

export interface PrepPack {
  topicId: string;
  title: string;
  prompt: string;
  sources: PrepSource[];
  userNotes?: string;
  timeboxMinutes?: number; // e.g. 10 min research window
}

export function buildPrepPack(topic: { id: string; title: string; prompt: string; sources: TopicSource[] }, userSources: PrepSource[] = [], timeboxMinutes = 10): PrepPack {
  return {
    topicId: topic.id,
    title: topic.title,
    prompt: topic.prompt,
    sources: [...topic.sources.map((s) => ({ ...s, addedBy: "system" as const })), ...userSources],
    timeboxMinutes,
  };
}

export function validatePrepSource(s: PrepSource): string[] {
  const errs: string[] = [];
  if (!s.name?.trim()) errs.push("source name required");
  if (!s.homepage?.trim()) errs.push("homepage required");
  else {
    try {
      const u = new URL(s.homepage);
      if (u.protocol !== "https:" && u.protocol !== "http:") errs.push("homepage must be https");
      // Homepage should be root — deep article URLs are ok for user-added evidence but warn
      if (u.pathname !== "/" && u.pathname.split("/").filter(Boolean).length > 1) errs.push("prefer root homepage over deep article URL");
    } catch {
      errs.push("homepage is not a valid URL");
    }
  }
  return errs;
}

export interface TimedFormat {
  id: string;
  label: string;
  secondsPerTurn: number;
  roundLimit: number;
  timeboxMinutes?: number; // prep time before first turn
}

export const TIMED_FORMATS: TimedFormat[] = [
  { id: "blitz", label: "Blitz — 60s / turn, 5 rounds", secondsPerTurn: 60, roundLimit: 5 },
  { id: "rapid", label: "Rapid — 3 min / turn, 5 rounds", secondsPerTurn: 180, roundLimit: 5 },
  { id: "classic", label: "Classic — 8 min / turn, 5 rounds", secondsPerTurn: 480, roundLimit: 5 },
  { id: "async-24h", label: "Async — 24h / turn, 7d total", secondsPerTurn: 86400, roundLimit: 5 },
  { id: "research-10", label: "Research — 10 min prep + 5 min / turn", secondsPerTurn: 300, roundLimit: 5, timeboxMinutes: 10 },
];

export function isTimedOverdue(startedAt: string, nowIso: string, secondsPerTurn: number): boolean {
  const diff = new Date(nowIso).getTime() - new Date(startedAt).getTime();
  return diff > secondsPerTurn * 1000;
}
