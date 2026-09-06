// Hand-labelled debate fixtures for the live judge benchmark.
// expectedWinner labels are provisional fixture truths, not corpus consensus.
//
// Stratification (v2): the original 3-fixture pack was too small to gate on —
// one mislabel moved agreement by 33 points. The pack is now stratified across
// expected winner (a/b/tie), domain, and difficulty style so regressions point
// at a failure mode rather than a single fixture:
//
//   expectedWinner: 4 × a, 4 × b, 4 × tie
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
