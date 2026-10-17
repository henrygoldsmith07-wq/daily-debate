// Anthropic list prices, so the spend meter charges what a call actually cost.
//
// The Messages API reports token usage but not cost. Before this table every
// Anthropic call was charged the flat declared AI_SPEND_UNCOSTED_CALL_USD
// ($0.02), which undercounts a full-transcript PvP judge call (up to 4096
// output tokens alone is ~$0.04 on claude-sonnet-5) and lets the daily cap be
// overshot by a multiple. Models missing from the table still fall back to the
// declared flat charge, so an unpriced override never reads as free.

/** USD per million tokens, Anthropic first-party API list price. */
interface ModelPrice {
  input: number;
  output: number;
}

// Longest id first: lookup is by prefix, so "claude-sonnet-5" must not shadow
// "claude-sonnet-5-5", and dated snapshot ids still resolve to their family.
const PRICES: ReadonlyArray<readonly [string, ModelPrice]> = [
  ["claude-sonnet-5-5", { input: 2, output: 10 }],
  ["claude-sonnet-5", { input: 2, output: 10 }],
  ["claude-sonnet-4-6", { input: 3, output: 15 }],
  ["claude-opus-5-5", { input: 4, output: 20 }],
  ["claude-opus-5", { input: 5, output: 25 }],
  ["claude-opus-4-8", { input: 5, output: 25 }],
  ["claude-opus-4-7", { input: 5, output: 25 }],
  ["claude-opus-4-6", { input: 5, output: 25 }],
  ["claude-haiku-5-5", { input: 0.1, output: 0.5 }],
  ["claude-haiku-4-5", { input: 1, output: 5 }],
  ["claude-fable-5-1", { input: 10, output: 50 }],
  ["claude-fable-5", { input: 10, output: 50 }],
];

function priceFor(model: string): ModelPrice | null {
  const id = model.trim().toLowerCase();
  for (const [prefix, price] of PRICES) {
    if (id === prefix || id.startsWith(`${prefix}-`) || id.startsWith(`${prefix}@`)) return price;
  }
  return null;
}

/**
 * Cost of one completed call from its reported token usage, or undefined when
 * the model is unpriced or usage is missing (the meter then applies the
 * declared uncosted-call charge).
 */
export function anthropicCallCostUsd(
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number | undefined {
  const price = priceFor(model);
  if (!price || typeof inputTokens !== "number" || typeof outputTokens !== "number") return undefined;
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return undefined;
  return ((Math.max(0, inputTokens) * price.input) + (Math.max(0, outputTokens) * price.output)) / 1_000_000;
}

/**
 * In-flight reservation for a call that has not run yet: its worst-case
 * output cost (the full max_tokens), never below the declared fallback.
 * Input tokens are unknown before the call and are not reserved.
 */
export function anthropicReservationUsd(model: string, maxTokens: number, fallbackUsd: number): number {
  const worstCaseOutput = anthropicCallCostUsd(model, 0, maxTokens);
  return worstCaseOutput === undefined ? fallbackUsd : Math.max(fallbackUsd, worstCaseOutput);
}
