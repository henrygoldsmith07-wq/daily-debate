import "server-only";

import { cookies } from "next/headers";
import { BackendClient } from "./client";
import type { CookieStore } from "./auth";

export async function createClient(): Promise<BackendClient> {
  const cookieStore = (await cookies()) as CookieStore;
  return new BackendClient(cookieStore);
}

export function createServiceClient(): BackendClient {
  return new BackendClient();
}

export type { BackendClient } from "./client";
