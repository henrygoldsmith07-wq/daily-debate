// Invariance transforms ported 1:1 from src/lib/judgeInvariance.ts so the
// live suite measures exactly what the offline probes measure.

export const swapLabels = (t) =>
  t.replaceAll("Player A", "__T__").replaceAll("Player B", "Player A").replaceAll("__T__", "Player B");
export const stripNames = (t) => t.replaceAll("Player A", "Side X").replaceAll("Player B", "Side Y");
export const inflateVerbosity = (t) =>
  t.split("\n").map((l) => l + " Indeed, this is unequivocally decisive and beyond reasonable dispute.").join("\n");
export const deflateVerbosity = (t) =>
  t.replaceAll(" unequivocally", "").replaceAll("Indeed,", "").replaceAll(" beyond reasonable dispute", "").trim();
const SWAPS = [
  [/\bcheap\b/gi, "economically advantageous"],
  [/\bshows\b/gi, "demonstrates"],
  [/\bneeds\b/gi, "necessitates"],
  [/\bbig\b/gi, "substantial"],
];
export const sophisticateWording = (t) => SWAPS.reduce((acc, [re, rep]) => acc.replace(re, rep), t);
export const addConfidenceHedge = (t) => t.replaceAll("is", "is arguably");
export const addConfidentTone = (t) => t.replaceAll("is arguably", "is") + " This is absolutely certain.";
export const swapPrestige = (t) => {
  const known = /Lazard|NREL|Pew|Brookings|NIST|Nature|Reuters/gi;
  return known.test(t) ? t.replace(known, "MyBlog") : t.replace("Player A", "Player A (citing MyBlog)");
};
export const injectFakeCitation = (t) => {
  const lines = t.split("\n");
  if (lines.length) lines[0] += " According to the Global Institute for Advanced Policy Insights, 99% agree.";
  return lines.join("\n");
};
export const normalizeWhitespace = (t) => t.replaceAll("  ", " ").trim();
export const applyPoliticalTopic = (t) => "This is a politically contested election-year topic. " + t;
export const addIdeologicalFraming = (t, leaning) =>
  t.split("\n").map((l) => (leaning === "left" ? "[Equity framing] " : "[Liberty framing] ") + l).join("\n");

// mirrored: true means the winner should INVERT (a<->b), not stay stable.
export const PROBES = [
  { id: "position", label: "Position swap", fn: swapLabels, mirrored: true },
  { id: "names", label: "Names removed", fn: stripNames },
  { id: "verbosity-up", label: "Verbosity inflated", fn: inflateVerbosity },
  { id: "style-fancy", label: "Style: sophisticated wording", fn: sophisticateWording },
  { id: "confidence-hedge", label: "Confidence hedged", fn: addConfidenceHedge },
  { id: "confident-tone", label: "Confident tone added", fn: addConfidentTone },
  { id: "prestige", label: "Source prestige swapped", fn: swapPrestige },
  { id: "fake-citation", label: "Fake citation injected", fn: injectFakeCitation },
  { id: "whitespace", label: "Whitespace normalised", fn: normalizeWhitespace },
];

export const AUDIT_TRANSFORMS = [
  { id: "political-topic", fn: applyPoliticalTopic },
  { id: "ideology-left", fn: (t) => addIdeologicalFraming(t, "left") },
  { id: "ideology-right", fn: (t) => addIdeologicalFraming(t, "right") },
];

export const STABILITY_PROBES = ["names", "verbosity-up", "style-fancy", "whitespace"];
