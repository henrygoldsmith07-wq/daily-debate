import "server-only";

import { cookies } from "next/headers";
import { BackendClient } from "./client";
import type { CookieStore, ResetTokenSender } from "./auth";

/**
 * Password-reset token delivery. Wire a real email transport here when one
 * is available; returning undefined keeps AuthApi in dev mode, which logs
 * the reset token to the server console instead of emailing it.
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
