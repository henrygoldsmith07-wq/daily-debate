// 93 curated fallback debate motions. Used when the AI pre-generation
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
  { title: "Election campaigns should be publicly funded and spending-capped", prompt: "Would replacing private campaign finance with capped public funding reduce corruption without entrenching incumbents?", category: "Policy" },
  { title: "Schools should start the day later for adolescent students", prompt: "Should secondary schools push start times past 9am to align with adolescent sleep science, even where transport schedules make it costly?", category: "Education" },
  { title: "Antibiotic use in livestock should be restricted to veterinary prescription", prompt: "Would banning routine preventative antibiotics in farming meaningfully slow resistance without harming food security?", category: "Health" },
  { title: "Tech companies should be required to offer data portability between competing services", prompt: "Should regulation force interoperability so users can move their social graph and history between platforms?", category: "Technology" },
  { title: "Museums should return looted artefacts to their countries of origin", prompt: "Should universal museums repatriate disputed collections, or do shared global access arguments justify retention?", category: "Ethics" },
  { title: "Night-time deliveries should be allowed in dense city centres to cut daytime congestion", prompt: "Would shifting freight to overnight windows reduce congestion and emissions enough to justify noise trade-offs?", category: "Transport" },
  { title: "Corporate boards should reserve seats for worker representatives", prompt: "Would mandatory worker representation on boards improve long-term decision-making or slow governance?", category: "Economics" },
  { title: "Deep-sea mining should be paused until environmental baselines are established", prompt: "Should the international seabed authority halt licences until independent ecological baselines and monitoring exist?", category: "Environment" },
  { title: "Online age verification should be centralised rather than platform-by-platform", prompt: "Would a single government-backed age-verification layer protect children better than dozens of private checks?", category: "Privacy" },
  { title: "Public transit should be fare-free at the point of use", prompt: "Would eliminating fares increase ridership and equity enough to offset the lost revenue and service trade-offs?", category: "Infrastructure" },
  { title: "Standardised units of measurement should extend to food nutrition labels internationally", prompt: "Should packaged-food labelling use one global reference format rather than country-specific schemes?", category: "Health" },
  { title: "Automated decision systems in welfare administration should face mandatory human review", prompt: "Should benefits decisions assisted by algorithms require a caseworker sign-off before any payment is stopped?", category: "Policy" },
  { title: "University research funding should require open publication of results", prompt: "Should public research grants be conditional on immediate open-access publication and data sharing?", category: "Science" },
  { title: "Urban rooftops should be required to host solar or green space", prompt: "Should cities mandate that large flat rooftops be used for energy generation or planted areas?", category: "Energy" },
  { title: "Prisons should offer university-level education to all serving sentences", prompt: "Should higher education be a standard part of rehabilitation rather than an earned privilege?", category: "Society" },
  { title: "Video game purchases should come with a right to refund within 14 days", prompt: "Should digital game and in-app purchases carry the same statutory refund window as physical goods?", category: "Technology" },
  { title: "Flood insurance should be pooled nationally across all property owners", prompt: "Should flood risk be mutualised nationally so premiums do not reflect local exposure alone?", category: "Policy" },
  { title: "Clinical guidelines should require shared decision-making documentation", prompt: "Should doctors be required to record that treatment options and patient preferences were discussed before major interventions?", category: "Medicine" },
  { title: "Supermarkets should be required to donate unsold edible food", prompt: "Would legally redirecting surplus food to charities reduce waste without shifting liability and cost onto retailers?", category: "Agriculture" },
  { title: "Sports governing bodies should cap squad sizes to cut air travel", prompt: "Would shrinking rosters and regional schedules reduce sport's aviation footprint without ruining competition quality?", category: "Environment" },
  { title: "Anonymous company ownership should be abolished worldwide", prompt: "Should every corporate beneficial owner be identified in a public registry to fight money laundering?", category: "Policy" },
  { title: "Personal carbon allowances should replace economy-wide carbon taxes", prompt: "Would equal per-person carbon budgets be fairer and more effective than taxing producers?", category: "Environment" },
  { title: "Algorithms used in criminal sentencing should be open source", prompt: "Should risk-assessment software used by courts be fully public so defendants can audit it?", category: "Ethics" },
  { title: "Bike lanes should physically separate from car traffic on every major urban road", prompt: "Should protected cycle infrastructure be a legal standard for arterial streets rather than paint-only lanes?", category: "Transport" },
  { title: "Sovereign debt contracts should include automatic climate-disaster pause clauses", prompt: "Should hurricane and flood events automatically suspend debt repayments for affected countries?", category: "Economics" },
  { title: "Adverts for high-carbon products should carry emissions labels like tobacco warnings", prompt: "Should flights, SUVs, and red meat advertise their footprint prominently at the point of sale?", category: "Policy" },
  { title: "National service should include a civilian option with the same duration", prompt: "Would mandatory civic service, with care work and climate corps alongside military tracks, strengthen social cohesion?", category: "Society" },
  { title: "Public libraries should lend laptops and hotspots as a core service", prompt: "Should libraries be funded as digital-inclusion hubs providing devices and connectivity, not just books?", category: "Infrastructure" },
  { title: "Emergency departments should have on-site mental health crisis teams around the clock", prompt: "Would embedding psychiatric crisis staff in every ER improve outcomes versus referral-only pathways?", category: "Health" },
  { title: "Search engines should be required to show results from across the political spectrum for civic queries", prompt: "Should platforms with search dominance surface viewpoint-diverse results on elections and public health?", category: "Technology" },
  { title: "Fast fashion should pay a textile-waste levy per garment", prompt: "Would per-item levies on clothing imports fund recycling infrastructure and slow overproduction?", category: "Environment" },
  { title: "Medical interpreters should be a legal right for hospital patients", prompt: "Should healthcare systems be required to provide professional interpretation for every language barrier?", category: "Medicine" },
  { title: "School holidays should be shortened and distributed more evenly across the year", prompt: "Would rebalancing the academic calendar reduce learning loss and childcare strain without exhausting teachers?", category: "Education" },
  { title: "Cities should convert one car lane on every major street into protected transit lanes", prompt: "Would a blanket bus-and-tram-lane mandate cut emissions and journey times more than targeted projects?", category: "Transport" },
  { title: "Inheritance above a high threshold should be taxed at capital rates", prompt: "Should large bequests be treated as capital gains to limit dynastic wealth, or does that double-tax families?", category: "Economics" },
  { title: "Wildfire-prone regions should mandate defensible-space rules around all buildings", prompt: "Should vegetation-clearance rules apply to every property in fire zones, enforced through insurance and inspection?", category: "Environment" },
  { title: "Social media accounts should require identity verification to post publicly, while remaining anonymous to readers", prompt: "Would verified-but-pseudonymous posting reduce harassment and disinformation without exposing users?", category: "Privacy" },
  { title: "Municipal water fountains should be a legal requirement per city block", prompt: "Should free drinking-water access points be mandated in urban planning codes?", category: "Health" },
  { title: "Universities should weight admissions by socio-economic background explicitly", prompt: "Would class-based admissions preferences improve fairness more than race-blind or test-only systems?", category: "Education" },
  { title: "Critical software in hospitals should be required to run on patched, supported systems", prompt: "Should regulators ban unsupported operating systems for medical devices and patient records?", category: "Security" },
  { title: "Residential streets should have a default 20 km/h speed limit", prompt: "Would defaulting residential zones to 20 km/h save lives without unacceptable journey-time costs?", category: "Transport" },
  { title: "Governments should pay farmers explicitly for soil carbon and biodiversity outcomes", prompt: "Should agricultural subsidies shift from production volume to measured environmental stewardship?", category: "Agriculture" },
  { title: "Phone manufacturers must support security updates for at least seven years", prompt: "Should minimum software-support windows for phones be legislated to cut e-waste and protect buyers?", category: "Technology" },
  { title: "National statistics offices should publish neighbourhood-level air-quality data in real time", prompt: "Would hyperlocal environmental monitoring drive faster cleanup than regional averages?", category: "Science" },
  { title: "Insurance should be barred from using credit scores in pricing", prompt: "Do credit-based premiums predict claims fairly, or do they entrench poverty?", category: "Economics" },
  { title: "Refugee status should extend to people displaced by climate disasters", prompt: "Should international law recognise climate displacement as grounds for protection and resettlement?", category: "Policy" },
  { title: "Company anonymised salary bands should be published for every role", prompt: "Would mandatory role-level pay bands inside large employers close gaps better than aggregate reporting?", category: "Economics" },
  { title: "Remote work rights: employers should justify any office mandate", prompt: "Should legislation require employers over a size threshold to demonstrate business necessity for attendance requirements?", category: "Society" },
  { title: "Court records should be anonymised by default and searchable only with consent", prompt: "Would restricting public criminal-record search engines improve rehabilitation at the cost of transparency?", category: "Privacy" },
  { title: "Every new public building should be net-zero operational from construction", prompt: "Should procurement rules exclude designs with ongoing fossil-fuel heating?", category: "Energy" },
  { title: "Organ donation should be opt-out nationally", prompt: "Would presumed-consent systems raise transplant rates without undermining family veto?", category: "Medicine" },
  { title: "Public exams should publish full past papers and marking schemes as a legal right", prompt: "Does mandatory transparency in assessment reduce coaching-privilege advantages?", category: "Education" },
  { title: "Cruise ships should be required to plug into shore power at every port", prompt: "Should ports mandate electrical shore connections so ships stop idling engines in harbour?", category: "Environment" },
  { title: "Digital identity wallets should be government-issued and privacy-preserving", prompt: "Would state-run digital ID with selective disclosure beat fragmented private logins?", category: "Security" },
  { title: "Sports betting advertising should be banned from live broadcasts", prompt: "Should gambling ads be excluded from match coverage to reduce addiction harms?", category: "Society" },
  { title: "Households should have a legal right to a smart meter and time-of-use tariffs", prompt: "Would universal dynamic pricing flatten demand peaks or penalise those who cannot shift usage?", category: "Energy" },
  { title: "Corporal punishment by parents should be illegal in all circumstances", prompt: "Should the legal defence for physical discipline of children be abolished to match standards already applied in schools?", category: "Society" },
  { title: "Airports should include a per-flight noise-and-emissions surcharge for night operations", prompt: "Would pricing night flights at their true community cost reduce sleep disruption without killing connectivity?", category: "Transport" },
  { title: "All publicly funded software must be open source by default", prompt: "Should code paid for by taxpayers carry an open licence unless security requires otherwise?", category: "Technology" },
  { title: "Rural broadband should be treated as a universal-service obligation like postal delivery", prompt: "Should minimum connectivity standards bind providers in low-density areas the way post offices once were?", category: "Infrastructure" },
  { title: "Hospitals should publish per-surgeon outcome statistics", prompt: "Would publishing individual surgeon outcomes empower patients, or push doctors away from high-risk cases?", category: "Medicine" },
  { title: "Cities should keep permanent car-free zones around primary schools at drop-off times", prompt: "Should school streets restrict cars at pick-up and drop-off permanently to cut pollution and improve safety?", category: "Environment" },
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
