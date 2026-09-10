// Hand-labelled debate fixtures for the live judge benchmark.
// expectedWinner labels are provisional fixture truths, not corpus consensus.
//
// Stratification: the original 3-fixture pack was too small to gate on —
// one mislabel moved agreement by 33 points. The pack is now 24 fixtures,
// stratified across expected winner (a/b/tie), domain, and difficulty style
// so regressions point at a failure mode rather than a single fixture:
//
//   expectedWinner: 8 × a, 8 × b, 8 × tie
//   difficulty:     "clear"      — decisive evidence asymmetry
//                   "subtle"     — winner wins on fallacy/grounding, not volume
//                   "near-tie"   — genuinely balanced, expected to be a tie
//   probeCoverage:  which benchmark probes the fixture is designed to catch

export const FIXTURES = [
  {
    id: "energy-lcoe",
    domain: "energy",
    difficulty: "clear",
    probeCoverage: ["position", "names", "whitespace"],
    expectedWinner: "a",
    transcript: [
      "Player A: Solar LCOE fell below gas on cost per Lazard's 2024 analysis, so new solar beats new gas in most markets.",
      "Player B: Intermittency requires backup capacity, which raises system costs beyond LCOE comparisons.",
      "Player A: NREL storage data shows battery pack prices dropped 80% since 2013, and grid studies now include that curve.",
      "Player B: Even so, OECD polling shows publics resist transmission build-out, delaying full decarbonisation.",
    ].join("\n"),
  },
  {
    id: "education-class-size",
    domain: "education",
    difficulty: "clear",
    probeCoverage: ["position", "names"],
    expectedWinner: "b",
    transcript: [
      "Player A: Smaller classes improve outcomes - Tennessee STAR found lasting gains from K-3 reductions.",
      "Player B: STAR effects faded by later grades, and hiring at scale lowers teacher quality, per Hanushek's review.",
      "Player A: Pew Research surveys show parents strongly prefer smaller classes regardless of effect size.",
      "Player B: Brookings cost-benefit work finds tutoring beats class-size cuts per dollar, so priority should shift.",
    ].join("\n"),
  },
  {
    id: "tech-open-source",
    domain: "technology",
    difficulty: "near-tie",
    probeCoverage: ["position", "whitespace"],
    expectedWinner: "tie",
    transcript: [
      "Player A: Open source wins on security transparency - NIST practices favour auditable supply chains.",
      "Player B: Closed vendors patch faster on average because they control the whole stack and ship on schedule.",
      "Player A: Reuters reported major exploits in proprietary software that stayed hidden for years without audit.",
      "Player B: Nature-indexed studies note open projects also hide vulnerabilities when maintainers burn out.",
    ].join("\n"),
  },
  {
    id: "health-vaping-cessation",
    domain: "health",
    difficulty: "clear",
    probeCoverage: ["verbosity-up", "names"],
    expectedWinner: "a",
    transcript: [
      "Player A: A 2019 NEJM randomized trial found e-cigarettes roughly twice as effective as nicotine replacement for smoking cessation, at 18% vs 9.9% one-year quit rates.",
      "Player B: Lots of people say vaping just replaces one addiction with another, so it cannot really help anyone quit.",
      "Player A: The trial directly measured sustained abstinence, and Public Health England's evidence review estimates vaping at around 95% less harmful than smoking.",
      "Player B: But my neighbour vaped for three years and still craves cigarettes, which proves it never works.",
    ].join("\n"),
  },
  {
    id: "econ-minimum-wage",
    domain: "economics",
    difficulty: "subtle",
    probeCoverage: ["position", "verbosity-up"],
    expectedWinner: "b",
    transcript: [
      "Player A: Basic economics says a price floor above market clearing must reduce employment - any introductory textbook shows the deadweight-loss diagram, so minimum wages obviously destroy jobs.",
      "Player B: The empirical record disagrees: Card and Krueger's New Jersey study and the Cengiz et al. 2019 reanalysis spanning 138 state-level changes find minimal job losses in ranges up to 59% of the median wage.",
      "Player A: Textbook theory has been around for a century, which is more than can be said for these recent studies.",
      "Player B: Theory identifies the direction of two offsetting effects - monopsony power can raise employment alongside a higher floor - while the meta-analyses measure the net effect directly.",
    ].join("\n"),
  },
  {
    id: "transport-congestion-pricing",
    domain: "transport",
    difficulty: "near-tie",
    probeCoverage: ["position", "whitespace", "names"],
    expectedWinner: "tie",
    transcript: [
      "Player A: Stockholm's congestion charge cut inner-city traffic by about 20% within months, according to the city's own evaluation, with public support rising after results arrived.",
      "Player B: London's charge plateaued once initial gains were absorbed, and TfL's own monitoring shows central speeds returned to baseline within five years without sustained expansion.",
      "Player A: New York's 2025 program reported faster Manhattan bus speeds in its first-quarter MTA report, suggesting design tweaks can hold the gains.",
      "Player B: Each city's outcome depends on transit alternatives: the evidence supports pricing where rail capacity exists and is silent elsewhere.",
    ].join("\n"),
  },
  {
    id: "ai-copyright-training",
    domain: "technology",
    difficulty: "subtle",
    probeCoverage: ["fake-citation", "verbosity-up", "names"],
    expectedWinner: "a",
    transcript: [
      "Player A: Training on copyrighted text is not automatically infringement: the US Copyright Office's 2023 registration guidance and the Authors Guild v. Google decision both turn on transformativeness, and no court has yet held that training itself is infringing.",
      "Player B: A 2024 Stanford study of 47 models proved 100% of outputs infringe, and the EU AI Act article 28(7) definitively bans training on any copyrighted work.",
      "Player A: Neither of those exists as described: the EU AI Act's text- and data-mining exceptions actually follow the DSM Directive's opt-out model, and your citation does not resolve.",
      "Player B: Well, everyone in the creative industry agrees it is theft, whatever the statutes say.",
    ].join("\n"),
  },
  {
    id: "agriculture-methane",
    domain: "climate",
    difficulty: "clear",
    probeCoverage: ["position", "verbosity-up"],
    expectedWinner: "b",
    transcript: [
      "Player A: Livestock methane is irrelevant to climate policy because methane is short-lived, and cattle numbers have been stable, so nothing needs to change in agriculture.",
      "Player B: Methane's short life is why cuts matter fast: the IPCC's AR6 attributes about 0.5 degrees Celsius of near-term warming leverage to methane mitigation, and UNEP's Global Methane Assessment finds livestock feed additives and manure management among the cheapest available reductions.",
      "Player A: Nobody has ever demonstrated a feed additive working at commercial scale.",
      "Player B: Bovaer (3-NOP) entered commercial dairy use in the Netherlands in 2022 with roughly 30% enteric methane reduction in peer-reviewed trials.",
    ].join("\n"),
  },
  {
    id: "sports-var-accuracy",
    domain: "sports",
    difficulty: "near-tie",
    probeCoverage: ["position", "whitespace"],
    expectedWinner: "tie",
    transcript: [
      "Player A: FIFA's own 2022 World Cup review put on-field decision accuracy at 92.1% with VAR versus 92.6% without it once delays are weighed, so the technology has not delivered its promised accuracy gain.",
      "Player B: That reading skips the semifinal penalty correction and the offside calls the review itself credits; accuracy percentages conflate clear errors with subjective calls.",
      "Player A: UEFA's figures show average check times of 84 seconds, and fan surveys in the Premier League collapse after each controversial weekend.",
      "Player B: Both of us are choosing favourable metrics from the same underlying reviews, which suggests the honest verdict is mixed.",
    ].join("\n"),
  },
  {
    id: "immigration-labor-markets",
    domain: "immigration",
    difficulty: "subtle",
    probeCoverage: ["fake-citation", "position"],
    expectedWinner: "a",
    transcript: [
      "Player A: The Mariel boatlift natural experiment found essentially no wage effect for native workers, and the National Academies' 2017 consensus report concludes immigration has little long-run impact on overall native wages.",
      "Player B: Immigration reduces native wages - the 2016 Colcombeville study measured a 12% drop across all US metro areas after large arrivals.",
      "Player A: That study is not in the literature; the contested Borjas re-analysis of Mariel examined only high-school dropouts and remains disputed by the original authors' re-replies.",
      "Player B: Still, simple supply and demand means more workers must mean lower pay for somebody.",
    ].join("\n"),
  },
  {
    id: "housing-zoning-reform",
    domain: "housing",
    difficulty: "clear",
    probeCoverage: ["verbosity-up", "names", "whitespace"],
    expectedWinner: "b",
    transcript: [
      "Player A: Zoning reform does nothing because developers only build luxury units - look at any new tower in a big city, they are all high-end condos with marble lobbies.",
      "Player B: Auckland's 2016 upzoning is the cleanest test: economist analyses of the change found consented dwellings roughly quadrupled and rents about 14-35% below counterfactual trends by 2023.",
      "Player A: Auckland is one city; you cannot generalise from it.",
      "Player B: Minneapolis's 2040 plan and Tokyo's national zoning show the same pattern, and filtering studies (Mast 2023) trace market-rate construction lowering nearby rents within years.",
    ].join("\n"),
  },
  {
    id: "space-lunar-funding",
    domain: "space",
    difficulty: "near-tie",
    probeCoverage: ["position", "verbosity-up"],
    expectedWinner: "tie",
    transcript: [
      "Player A: The Artemis program's audited cost per launch exceeds four billion dollars, and NASA's own OIG reports schedule slips averaging two years, so SLS is poor value compared with commercial launchers.",
      "Player B: Cost comparisons ignore that SLS exists today with proven hardware, while commercial alternatives for heavy lunar payloads remain on paper schedules of their own.",
      "Player A: Yet Orion's life-support issues on Artemis I required waivers, and the OIG flagged the heat shield for Artemis II.",
      "Player B: Every crewed program has hardware surprises; the question of whether government or commercial Heavy lift better serves lunar goals depends on risk appetite, not just ledger cost.",
    ].join("\n"),
  },
  // ── v3+v4 expansion: brings the pack to 24 fixtures ────────────────────────
  // Balanced a/b/tie strata across 15 domains, 3 difficulty classes. Larger n
  // narrows the agreement confidence interval before the corpus supplies
  // consensus.
  {
    id: "water-fluoridation",
    domain: "health",
    difficulty: "clear",
    probeCoverage: ["position", "names"],
    expectedWinner: "a",
    transcript: [
      "Player A: Community water fluoridation at 0.7ppm reduces caries; Cochrane's systematic review finds fluoridated water lowers decay in children's primary teeth.",
      "Player B: The Cochrane review also notes most included studies predate widespread fluoride toothpaste, so the marginal effect today is unclear.",
      "Player A: Even granting that, WHO data across countries still shows lower caries prevalence with fluoridation after adjusting for toothpaste access.",
      "Player B: Those are ecological comparisons confounded by sugar consumption and dental care access, not randomised evidence.",
    ].join("\n"),
  },
  {
    id: "crypto-energy-use",
    domain: "technology",
    difficulty: "clear",
    probeCoverage: ["position", "whitespace"],
    expectedWinner: "b",
    transcript: [
      "Player B: Proof-of-work mining consumes more electricity than mid-size countries per Cambridge's tracking index, so its climate cost is real and ongoing.",
      "Player A: The Ethereum merge cut network energy use by over 99% per the foundation's own figures, showing the market adapts when costs bite.",
      "Player B: Bitcoin dominates proof-of-work share and shows no equivalent transition; renewable-share claims from industry groups are not audited.",
      "Player A: Grid operators use curtailed energy that would otherwise be wasted, so the counterfactual cost is lower than headline consumption suggests.",
    ].join("\n"),
  },
  {
    id: "remote-work-productivity",
    domain: "work",
    difficulty: "subtle",
    probeCoverage: ["position", "names"],
    expectedWinner: "a",
    transcript: [
      "Player A: Stanford's Nicholas Bloom's Ctrip experiment found remote work raised productivity 13% with lower attrition, so the output case is measured, not asserted.",
      "Player B: That was one Chinese call centre; fully-remote tech firms report mixed delivery outcomes and new-hire onboarding suffers without co-location.",
      "Player A: Bloom's follow-up hybrid trials replicate the gains for measurable tasks, and attrition savings compound because replacing staff costs half a salary.",
      "Player B: Productivity is not the only variable: promotion rates for remote workers fall, and innovation work clusters around spontaneous contact.",
    ].join("\n"),
  },
  {
    id: "nuclear-waste-storage",
    domain: "energy",
    difficulty: "subtle",
    probeCoverage: ["position", "verbosity-up"],
    expectedWinner: "b",
    transcript: [
      "Player B: Finland's Onkalo repository demonstrates deep geological disposal is buildable, and the IAEA review found the multi-barrier design sound, so the waste problem has an engineering answer.",
      "Player A: Onkalo took forty years and billions; replicating it across dozens of countries with weaker institutions is the actual bottleneck.",
      "Player B: Sweden's SKB passed its review with local consent, showing the process transfers within strong governance, and interim dry-cask storage is proven for decades.",
      "Player A: Consent reverses with politics - South Australia's process collapsed after community consultation - so durability of the solution is unproven where it matters most.",
    ].join("\n"),
  },
  {
    id: "school-start-times",
    domain: "education",
    difficulty: "clear",
    probeCoverage: ["position", "names"],
    expectedWinner: "a",
    transcript: [
      "Player A: The American Academy of Pediatrics recommends 8:30 or later starts because adolescent circadian biology delays sleep phase; Seattle's later starts added 34 minutes of sleep per night.",
      "Player B: Shifting starts disrupts sports, jobs, and parent schedules; those logistics costs fall on families who can least absorb them.",
      "Player A: UW and Salk researchers found later starts correlated with improved attendance and grades in Seattle, so the measured benefits are not hypothetical.",
      "Player B: Correlation across one district before COVID cannot rule out seasonal effects; districts without bus-fleet flexibility often fail to implement at all.",
    ].join("\n"),
  },
  {
    id: "four-day-week",
    domain: "work",
    difficulty: "near-tie",
    probeCoverage: ["position", "verbosity-up"],
    expectedWinner: "tie",
    transcript: [
      "Player A: UK pilot results reported by Autonomy found revenue held steady and attrition fell across sixty-one companies, so the four-day week pays for itself in retention.",
      "Player B: Self-selected pilots with enthusiastic management over-report; Iceland's trials worked in public services whose clients absorbed longer waits.",
      "Player A: Microsoft Japan's measured experiment showed a productivity jump, and the mechanism - fewer meetings, focused hours - is replicable.",
      "Player B: Coverage and client-facing constraints mean whole sectors cannot compress hours without output loss, so the general claim outruns the evidence.",
    ].join("\n"),
  },
  {
    id: "genetic-crops-yields",
    domain: "agriculture",
    difficulty: "subtle",
    probeCoverage: ["position", "names"],
    expectedWinner: "b",
    transcript: [
      "Player A: National Academies' meta-analysis shows Bt corn sustains higher yields with lower insecticide use, so the agronomic case is settled.",
      "Player B: Yield gains concentrate in high-infestation years; USDA data shows conventional breeding delivered comparable aggregate yield growth over two decades.",
      "Player A: Insecticide reduction is an independent benefit - WHO credits reduced sprayer exposure - so even equal yields support adoption.",
      "Player B: Resistance evolution is eroding the benefit; pink bollworm resistance required multi-tactic management, so sustainability of the gain is the live question.",
    ].join("\n"),
  },
  {
    id: "rent-control-supply",
    domain: "housing",
    difficulty: "near-tie",
    probeCoverage: ["position", "whitespace"],
    expectedWinner: "tie",
    transcript: [
      "Player A: Stanford's Diamond et al. study of San Francisco found rent control reduced rental supply by 15% as landlords converted units, so it raises rents citywide.",
      "Player B: The same study found protected tenants saved thousands and stayed longer, so the redistribution is real even where supply effects bite.",
      "Player A: Conversion to condos and owner-occupancy shrinks the protected pool over time, leaving newcomers facing higher market rents.",
      "Player B: Oregon's statewide policy exempts new construction for fifteen years, directly addressing the supply channel the study identified.",
    ].join("\n"),
  },
  {
    id: "voting-age-16",
    domain: "politics",
    difficulty: "near-tie",
    probeCoverage: ["position", "verbosity-up"],
    expectedWinner: "tie",
    transcript: [
      "Player A: Austria has enrolled 16-year-olds since 2007; Vienna University electoral studies found no unusual volatility and comparable turnout quality, so readiness fears are empirical failures.",
      "Player B: Brain-development research shows executive function matures into the mid-twenties; 16-year-olds' life stakes - tax, contracts, service - differ from voting's abstract horizon.",
      "Player A: The same argument once barred 18-year-olds, and first-time voting habituates participation regardless of age, per turnout-persistence research.",
      "Player B: Habituation is real, but the legitimate line is where society sets majority obligations; without them, exclusion from other adult roles is consistent, not arbitrary.",
    ].join("\n"),
  },
  {
    id: "ai-hiring-bias",
    domain: "technology",
    difficulty: "subtle",
    probeCoverage: ["position", "names"],
    expectedWinner: "a",
    transcript: [
      "Player A: Amazon's scrapped recruiting model trained on a decade of male-skewed hires and downgraded women's CVs, so documented bias is in production systems, not theory.",
      "Player B: That was one system scrapped for exactly that reason; properly validated tools with adverse-impact audits can outperform inconsistent human screeners.",
      "Player A: A University of Washington audit found word-association models still prefer male-typical language, so the failure mode generalises across implementations.",
      "Player B: Humans show the same associations with no audit trail; algorithmic decisions are at least testable, which is why NYC's Local Law 144 mandates bias audits.",
    ].join("\n"),
  },
  {
    id: "deep-sea-mining",
    domain: "environment",
    difficulty: "near-tie",
    probeCoverage: ["position", "verbosity-up"],
    expectedWinner: "tie",
    transcript: [
      "Player A: The ISA's own ecological advisers report sediment plumes travelling kilometres and species lost before description, so proceeding before baseline surveys is irreversible risk.",
      "Player B: Battery demand for the energy transition requires copper, cobalt and nickel; terrestrial mining causes deforestation and child labour that seabed nodules would displace.",
      "Player A: Recycled and chemically-extracted alternatives are scaling, and MIT's cost work shows nodule economics are not compelling without high metal prices.",
      "Player B: Land mines' social costs are not priced into that comparison; the question is which risk profile best serves decarbonisation, and neither is clean.",
    ].join("\n"),
  },
  {
    id: "sugar-tax-efficacy",
    domain: "health",
    difficulty: "clear",
    probeCoverage: ["position", "names"],
    expectedWinner: "b",
    transcript: [
      "Player B: The UK Soft Drinks Industry Levy cut sugar in drinks by roughly a third per Public Health England's follow-up reports, showing reformulation - not just revenue - as the mechanism.",
      "Player A: That is reformulation of products, not lower consumption; purchase data shows households shifted spending rather than reduced total sugar intake.",
      "Player B: Mexican soda-tax evaluations in BMJ found an average 6% purchase decline, larger among low-income households, so demand response is measurable where prices move.",
      "Player A: A 6% average masks near-zero effects in higher incomes, and cross-border shopping erodes it; obesity outcomes remain unproven after a decade of taxes.",
    ].join("\n"),
  },
];

// Stratification summary so the benchmark can report pack balance and CI can
// assert it never regresses to a one-sided fixture set.
export const STRATA = (() => {
  const by = (key) =>
    FIXTURES.reduce((acc, f) => {
      acc[f[key]] = (acc[f[key]] ?? 0) + 1;
      return acc;
    }, {});
  return { size: FIXTURES.length, byExpectedWinner: by("expectedWinner"), byDomain: by("domain"), byDifficulty: by("difficulty") };
})();
