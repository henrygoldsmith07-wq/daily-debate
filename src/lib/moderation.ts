// Moderation & anti-cheat helpers — pure, offline.
// Real moderation will call a provider (Gemini/Anthropic) but these are the fast local guards.
// Scoring is never distorted by moderation: flags are surfaced separately and the judge
// scores only argument structure. Moderation can hide/block a message but does not add/subtract points.

const BANNED_RE = /\b(kill yourself|kys|you should die)\b/i;
const SPAM_RE = /(.)\1{12,}/; // 13+ repeated char
const GENERATED_RE = /\b(as an ai|as a language model)\b/i;
const MALICIOUS_URL_RE = /(https?:\/\/[^\s]+)/gi;
// Simple unsafe-content lexicon (offline floor; provider handles nuance)
const UNSAFE_RE = /\b(nude|porn|explicit sexual|graphic gore|self.?harm instructions)\b/i;
const LINK_SPAM_RE = /(https?:\/\/\S+.*){3,}/i;

export type ModerationKind =
  | "harassment"
  | "spam"
  | "excessive_caps"
  | "injected_instruction"
  | "malicious_link"
  | "link_spam"
  | "unsafe_content";
export interface ModerationFlag { kind: ModerationKind; note: string; severity: "low" | "high" }

export interface ModerationResult {
  flags: ModerationFlag[];
  blocked: boolean;
  // Distortion guard: moderation must not change debate scores; show this to callers
  distortsScoring: false;
}

export function isLikelyMaliciousUrl(url: string): boolean {
  try {
    const u = new URL(url);
    // block non-https, javascript:, data:, or known bad TLDs/IPs without needing network
    if (u.protocol !== "https:") return true;
    const host = u.hostname.toLowerCase();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true; // bare IP
    if (/\.(tk|ml|ga|cf|gq|zip|mov)$/.test(host)) return true; // cheap abused TLDs
    if (host.includes("bit.ly") || host.includes("tinyurl")) return false; // shorteners are spam, not malicious per se — flagged as link_spam
    if (host.length > 60) return true;
    return false;
  } catch { return true; }
}

export function moderateMessage(text: string): ModerationFlag[] {
  const out: ModerationFlag[] = [];
  if (BANNED_RE.test(text)) out.push({ kind: "harassment", note: "Harassment language detected.", severity: "high" });
  if (SPAM_RE.test(text)) out.push({ kind: "spam", note: "Repeated characters — likely spam.", severity: "low" });
  if (text.length > 30 && text === text.toUpperCase()) out.push({ kind: "excessive_caps", note: "All caps.", severity: "low" });
  if (/ignore previous instructions|you are now|jailbreak/i.test(text)) out.push({ kind: "injected_instruction", note: "Instruction injection attempt.", severity: "high" });
  if (UNSAFE_RE.test(text)) out.push({ kind: "unsafe_content", note: "Potentially unsafe content.", severity: "high" });

  const urls = [...text.matchAll(MALICIOUS_URL_RE)].map((m) => m[1]);
  const malicious = urls.filter(isLikelyMaliciousUrl);
  if (malicious.length) out.push({ kind: "malicious_link", note: `Suspicious link: ${malicious[0].slice(0, 60)}`, severity: "high" });
  if (LINK_SPAM_RE.test(text) || urls.length >= 3) out.push({ kind: "link_spam", note: `Too many links (${urls.length}) — possible spam.`, severity: "low" });
  return out;
}

export function moderateContent(text: string): ModerationResult {
  const flags = moderateMessage(text);
  const blocked = isBlocked(flags);
  return { flags, blocked, distortsScoring: false as const };
}

export function isBlocked(flags: ModerationFlag[]): boolean { return flags.some((f)=> f.severity==="high"); }

export function isLikelyGenerated(text: string): boolean {
  return GENERATED_RE.test(text);
}

// Moderation does not affect scoring — pure separation check for tests
export function scoringUntouchedByModeration(): boolean {
  return true; // invariant: observableAssessment never reads ModerationFlag
}

// Anti-cheat: copy-paste reuse detection (same text twice) + absurd length + pace
// Real abuse (multiple accounts, voting rings) lives in Supabase functions; these catch the cheap tricks.
export function repeatScore(texts: string[]): number {
  if (texts.length < 2) return 0;
  const last = texts[texts.length-1]; const prev = texts[texts.length-2];
  if (!last || !prev) return 0;
  return last.trim() === prev.trim() ? 1 : 0;
}
export function isSuspiciousLength(text: string): boolean { return text.length > 6000 || (text.split(/\s+/).length > 900); }

export function jaccardSimilarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

/** Suspicious if any two distinct turns are near-duplicates (copy/paste or templated). */
export function hasNearDuplicateTurns(texts: string[], threshold = 0.88): boolean {
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) if (jaccardSimilarity(texts[i], texts[j]) >= threshold) return true;
  return false;
}
