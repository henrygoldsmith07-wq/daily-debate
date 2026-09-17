import "server-only";

import { cookies } from "next/headers";
import { BackendClient } from "./client";
import type { CookieStore, ResetTokenSender } from "./auth";

/**
 * Password-reset token delivery. Wire a real email transport here — while
 * this returns undefined, reset tokens are generated and stored but never
 * delivered, so password reset cannot complete.
 */
function resolveResetTokenSender(): ResetTokenSender | undefined {
  return undefined;
}

export async function createClient(): Promise<BackendClient> {
  const cookieStore = (await cookies()) as CookieStore;
  return new BackendClient(cookieStore, resolveResetTokenSender());
}

export function createServiceClient(): BackendClient {
  return new BackendClient(null, resolveResetTokenSender());
}

export type { BackendClient } from "./client";
