/**
 * Prep cards (DebateOwl's prep, copied): for each side of a motion, its
 * strongest point and one "If they say..." exchange. About the motion only:
 * the same for every learner, never naming a skill (retestDisclosure.ts).
 */

export interface PrepSide {
  strongest: string;
  ifTheySay: string;
  reply: string;
}

export interface MotionPrep {
  for: PrepSide;
  against: PrepSide;
}

const MAX_CHARS = 400;

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > MAX_CHARS) return null;
  return text;
}

function cleanSide(value: unknown): PrepSide | null {
  if (!value || typeof value !== "object") return null;
  const side = value as Record<string, unknown>;
  const strongest = cleanText(side.strongest);
  const ifTheySay = cleanText(side.ifTheySay);
  const reply = cleanText(side.reply);
  return strongest && ifTheySay && reply ? { strongest, ifTheySay, reply } : null;
}

/** A model's or the cache's prep, cleaned; null when any part is missing or out of bounds. */
export function parseMotionPrep(value: unknown): MotionPrep | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const forSide = cleanSide(raw.for);
  const againstSide = cleanSide(raw.against);
  return forSide && againstSide ? { for: forSide, against: againstSide } : null;
}
