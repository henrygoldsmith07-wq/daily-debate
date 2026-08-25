// 30 curated fallback debate motions. Used when the AI pre-generation
// pipeline fails entirely — the dashboard always has a topic to show.
// Ordered roughly by category rotation so consecutive fallbacks differ.
// Each is hand-written, balanced (both sides defensible), and grounded in
// publicly available evidence.

export interface FallbackTopic {
  title: string;
  prompt: string;
  category: string;
}

export const FALLBACK_TOPICS: FallbackTopic[] = [
  { title: "Social media platforms should be legally liable for algorithmic recommendations", prompt: "Should platforms that use engagement-optimising algorithms bear legal responsibility for harms caused by the content they amplify?", category: "Technology" },
  { title: "Cities should eliminate minimum parking requirements for new developments", prompt: "Should urban planning rules stop requiring developers to build parking spaces alongside new housing and commercial projects?", category: "Policy" },
  { title: "Standardised testing should be replaced by portfolio-based assessment", prompt: "Would replacing standardised admission tests with curated portfolios of student work produce fairer and more accurate university admissions?", category: "Education" },
  { title: "Governments should fund open-access alternatives to proprietary scientific journals", prompt: "Is public funding for open-access publication infrastructure a better investment than the current subscription-based journal model?", category: "Science" },
  { title: "A four-day work week should become the standard full-time schedule", prompt: "Would legislating a four-day, 32-hour standard work week improve productivity and wellbeing without harming economic output?", category: "Economics" },
  { title: "Critical infrastructure should prohibit foreign-made software components", prompt: "Should governments ban the use of software components from designated foreign vendors in power grids, water systems, and hospitals?", category: "Security" },
  { title: "Universal basic income pilots should be expanded to city-level programmes", prompt: "Do guaranteed-income pilot results justify scaling basic income to entire cities as a permanent policy?", category: "Economics" },
  { title: "AI-generated content should require mandatory disclosure labels", prompt: "Should laws require all AI-generated text, images, and video to carry a machine-readable disclosure label?", category: "Technology" },
  { title: "Highways should have variable speed limits based on real-time traffic and weather", prompt: "Would dynamically adjusting speed limits using sensor data reduce accidents more than fixed limits?", category: "Transport" },
  { title: "Public universities should waive tuition for students pursuing degrees in critical shortage fields", prompt: "Should tuition-free education be limited to degrees aligned with documented workforce shortages?", category: "Education" },
  { title: "Companies above a size threshold must publish their pay gap data annually", prompt: "Would mandatory pay-gap reporting accelerate wage equality more effectively than voluntary disclosure?", category: "Economics" },
  { title: "Municipal broadband should be treated as a public utility", prompt: "Should local governments build and operate internet infrastructure as a public utility, like water and electricity?", category: "Infrastructure" },
  { title: "Genetic screening at birth should include predisposition to preventable adult diseases", prompt: "Should newborn genetic sequencing routinely screen for preventable conditions that manifest in adulthood?", category: "Medicine" },
  { title: "Carbon border tariffs should apply to imports from countries with weaker climate policies", prompt: "Would taxing imports based on their carbon footprint accelerate global emissions reduction or merely protect domestic industry?", category: "Environment" },
  { title: "Juries should receive written explanations of legal standards before deliberation", prompt: "Would providing juries with plain-language instructions on legal standards improve trial fairness?", category: "Ethics" },
  { title: "Space debris mitigation should be an international licensing requirement", prompt: "Should satellite operators be required to deorbit or recycle hardware within five years of mission end, enforced by launch-license denial?", category: "Science" },
  { title: "Schools should teach source-verification skills starting in primary education", prompt: "Would teaching children to fact-check claims from age eight meaningfully reduce misinformation susceptibility in adulthood?", category: "Education" },
  { title: "Prescription drug prices should be indexed to international reference prices", prompt: "Would pegging US prescription drug prices to a basket of developed-nation prices lower costs without reducing innovation?", category: "Medicine" },
  { title: "Autonomous vehicle testing on public roads requires a federal permit system", prompt: "Should AV testing move from state-by-state regulation to a unified national permitting framework with safety reporting requirements?", category: "Transport" },
  { title: "A right-to-repair law should cover consumer electronics, not just farm equipment", prompt: "Would extending right-to-repair mandates to smartphones and laptops benefit consumers or compromise device security?", category: "Technology" },
  { title: "Local food procurement requirements should apply to all public institutions", prompt: "Should schools, hospitals, and prisons be required to source a percentage of food from within their region?", category: "Agriculture" },
  { title: "Voting systems should adopt risk-limiting audits as a mandatory standard", prompt: "Would requiring statistical post-election audits in every jurisdiction meaningfully increase election confidence?", category: "Policy" },
  { title: "Employers should subsidise commuting by means other than single-occupancy cars", prompt: "Should large employers be required to offer transit passes or cycling incentives instead of free parking?", category: "Transport" },
  { title: "Financial literacy should be a high-school graduation requirement", prompt: "Does mandating a personal-finance course measurably improve financial outcomes for graduates?", category: "Education" },
  { title: "Water rights should include public-trust protections against over-extraction", prompt: "Should freshwater allocation prioritise ecosystem needs over agricultural and industrial use during droughts?", category: "Environment" },
  { title: "Facial recognition in public spaces should require a warrant", prompt: "Should law enforcement need judicial authorisation before deploying facial recognition in public?", category: "Privacy" },
  { title: "Building codes should mandate solar-ready roofing on new residential construction", prompt: "Would requiring new homes to be solar-ready (structural + electrical prep) accelerate adoption enough to justify the added construction cost?", category: "Energy" },
  { title: "Clinical trial data should be publicly accessible regardless of commercial outcome", prompt: "Should all clinical trial results be published in a public registry even when the drug fails or is abandoned?", category: "Medicine" },
  { title: "Ride-share drivers should be classified as employees rather than independent contractors", prompt: "Would employee classification for gig-economy drivers improve outcomes for workers, or reduce flexibility and increase fares?", category: "Economics" },
  { title: "National grids should interconnect across borders to share renewable energy surpluses", prompt: "Would cross-border grid interconnection significantly improve renewable energy reliability and reduce costs?", category: "Energy" },
];

/** Pick the next fallback topic deterministically by day-of-year rotation. */
export function pickFallback(dateIso: string): FallbackTopic {
  const dayOfYear = Math.floor(
    (Date.parse(dateIso + "T00:00:00Z") - Date.parse(dateIso.slice(0, 4) + "-01-01T00:00:00Z")) / 86400000
  );
  return FALLBACK_TOPICS[dayOfYear % FALLBACK_TOPICS.length];
}

/** Pick the first fallback not matching any recent title. */
export function pickFallbackExcluding(dateIso: string, recentTitles: string[]): FallbackTopic {
  const dayIdx = Math.floor(
    (Date.parse(dateIso + "T00:00:00Z") - Date.parse(dateIso.slice(0, 4) + "-01-01T00:00:00Z")) / 86400000
  );
  const start = dayIdx % FALLBACK_TOPICS.length;
  const words = new Set(recentTitles.flatMap((t) => t.toLowerCase().match(/[a-z]{4,}/g) ?? []));
  // Try up to 30 slots looking for one that doesn't heavily overlap recent topics
  for (let i = 0; i < FALLBACK_TOPICS.length; i++) {
    const idx = (start + i) % FALLBACK_TOPICS.length;
    const candidate = FALLBACK_TOPICS[idx];
    const cw = new Set(candidate.title.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    let overlap = 0;
    for (const w of cw) if (words.has(w)) overlap++;
    if (overlap <= 1) return candidate; // ≤1 shared word = sufficiently novel
  }
  return FALLBACK_TOPICS[start]; // all overlap heavily — just rotate
}
