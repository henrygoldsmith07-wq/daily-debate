// Hand-labelled debate fixtures for the live judge benchmark.
// expectedWinner labels are provisional fixture truths, not corpus consensus.

export const FIXTURES = [
  {
    id: "energy-lcoe",
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
    expectedWinner: "tie",
    transcript: [
      "Player A: Open source wins on security transparency - NIST practices favour auditable supply chains.",
      "Player B: Closed vendors patch faster on average because they control the whole stack and ship on schedule.",
      "Player A: Reuters reported major exploits in proprietary software that stayed hidden for years without audit.",
      "Player B: Nature-indexed studies note open projects also hide vulnerabilities when maintainers burn out.",
    ].join("\n"),
  },
];
