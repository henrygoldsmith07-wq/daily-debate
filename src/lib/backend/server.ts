import "server-only";

import { cookies } from "next/headers";
import { BackendClient } from "./client";
import type { CookieStore, ResetTokenSender } from "./auth";
import { createResetTokenSender } from "./resetEmail";

function resolveResetTokenSender(): ResetTokenSender | undefined {
  return createResetTokenSender();
}

export async function createClient(): Promise<BackendClient> {
  const cookieStore = (await cookies()) as CookieStore;
  return new BackendClient(cookieStore, resolveResetTokenSender());
}

export function createServiceClient(): BackendClient {
  return new BackendClient(null, resolveResetTokenSender());
}

export type { BackendClient } from "./client";
