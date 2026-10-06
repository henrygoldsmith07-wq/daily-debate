export const CLIENT_PRODUCT_EVENT_NAMES = [
  "daily_viewed",
  "full_analysis_opened",
  "progress_viewed",
  "pvp_started",
  "repair_started",
] as const;

export type ClientProductEventName = (typeof CLIENT_PRODUCT_EVENT_NAMES)[number];

export function isClientProductEventName(value: unknown): value is ClientProductEventName {
  return typeof value === "string" && (CLIENT_PRODUCT_EVENT_NAMES as readonly string[]).includes(value);
}
