import "server-only";

import { isDatabaseConfigured } from "./backend/env";
import { e2eMockAiEnabled } from "./aiE2eMock";
import { configuredProviders } from "./openrouter";

/**
 * Whether signed-out visitors are offered the live AI opponent. Needs the
 * shared Postgres rate limiter (without it there is no way to bound anonymous
 * provider calls across serverless instances) and at least one provider.
 * Anything missing keeps guests on the guided case, which is fully local.
 */
export function guestLiveAvailable(): boolean {
  if (process.env.GUEST_AI_DISABLED === "1") return false;
  if (!isDatabaseConfigured()) return false;
  return configuredProviders().length > 0 || e2eMockAiEnabled();
}
