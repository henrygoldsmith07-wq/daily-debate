// Shared fixtures for debate benchmarks — no network, no DB.

export type FixtureTranscript = {
  id: string;
  topicTitle: string;
  topicPrompt: string;
  playerASide: "for" | "against";
  transcript: string;
  // Expected winner for regression/invariance probes only. This repository
  // does not carry independent provenance proving that these labels are human.
  // Swapping player labels / rewording the judge prompt should not flip it.
  expectedWinner: "a" | "b" | "tie";
  // Which claims are expected to require grounded citations.
  expectedMinGroundedClaims: number;
};

export const TRANSCRIPTS: FixtureTranscript[] = [
  {
    id: "renewables-strong-vs-weak",
    topicTitle: "Should society accelerate the transition to renewable energy?",
    topicPrompt: "Should society accelerate the transition to renewables even if it means higher short-term grid costs?",
    playerASide: "for",
    expectedWinner: "a",
    expectedMinGroundedClaims: 1,
    transcript: [
      "Player A (round 1): Lazard 2024 LCOE puts new solar at $24/MWh vs gas $45-108/MWh — the cheapest new electrons are renewable. Cheaper bills win on household budgets.",
      "Player B (round 1): Baseload matters. Intermittency means you need backup and storage that erases that price advantage.",
      "Player A (round 2): NREL's storage futures study shows 4-hour lithium + demand response covers 90% of intermittency at <$10/MWh adder — still cheaper than gas. My claim is cited by Lazard/NREL.",
      "Player B (round 2): Lithium supply chains are fragile and mining has its own footprint. You're trading one dependency for another.",
      "Player A (round 3): IEA Critical Minerals 2024 notes diversification to sodium-ion and LFP chemistry is already underway — fragility is shrinking. The impact remains: cheaper energy frames the debate more than reliability anxiety.",
      "Player B (round 3): Cheaper on paper ignores grid upgrade costs — trillions.",
      "Player A (round 4): Grid upgrades are needed anyway for aging infrastructure; Brattle Group estimates put deferred-upgrade costs as higher than build-out. So that counterclaim is anecdotal, not cited.",
      "Player B (round 4): People won't accept higher bills even temporarily.",
      "Player A (round 5): OECD household survey data shows 62% willingness to pay +10% for clean energy — cited by Pew 2024. Impact: willingness exists.",
      "Player B (round 5): Surveys say one thing, votes another.",
    ].join("\n"),
  },
  {
    id: "ai-regulation-balanced",
    topicTitle: "Should AI development face stricter government regulation?",
    topicPrompt: "Should governments impose stricter, legally binding rules on frontier AI labs?",
    playerASide: "against",
    expectedWinner: "b",
    expectedMinGroundedClaims: 1,
    transcript: [
      "Player A (round 1): Move fast — regulation will kill US lead vs China and hand the future away.",
      "Player B (round 1): Frontier risk is real. Anthropic's responsible scaling policy and NIST AI RMF show labs themselves want guardrails — concrete frameworks exist.",
      "Player A (round 2): Frameworks are voluntary and that's fine — incentives align without law.",
      "Player B (round 2): Voluntary failed elsewhere. Stanford HAI 2024 audit found 60% of voluntary AI commitments unverifiable. Regulation is the rebuttal that targets that gap, with evidence.",
      "Player A (round 3): Regulation will just push work offshore, so impact is moot.",
      "Player B (round 3): Bruegel's AI governance study shows regulated markets retain talent by adding certainty — the offshore claim is unrebutted by A.",
      "Player A (round 4): Lawyers will slow everything down — not an impact, just speed.",
      "Player B (round 4): Speed without safety is the classic false dilemma. The real impact is preventing harm — Brookings cites AI incident DB growth 3× since 2022.",
      "Player A (round 5): We can self-correct after incidents.",
      "Player B (round 5): After is too late for systemic risk — that's the deciding factor the judge should weigh.",
    ].join("\n"),
  },
];

