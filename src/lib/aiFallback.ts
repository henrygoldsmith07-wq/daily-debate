// Provider fallback: run the primary model call, validate the output shape,
// and fall back to the alternate provider on failure OR invalid output.
// OpenRouter is primary; Anthropic is the alternate. Pure orchestration — no
// provider imports here.

export type AiProvider<T> = () => Promise<T>;

export async function withProviderFallback<T>(
  primary: AiProvider<T>,
  validate: (value: T) => boolean,
  fallback: AiProvider<T>,
): Promise<T> {
  try {
    const result = await primary();
    if (!validate(result)) {
      throw new Error("Primary provider returned an output that failed schema validation.");
    }
    return result;
  } catch (primaryError) {
    console.error(
      "AI provider failed — falling back:",
      primaryError instanceof Error ? primaryError.message : primaryError,
    );
    const alt = await fallback();
    if (!validate(alt)) {
      throw new Error("Alternate provider also returned an invalid output.");
    }
    return alt;
  }
}
