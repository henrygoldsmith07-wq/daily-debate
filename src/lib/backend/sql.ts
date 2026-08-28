import "server-only";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { databaseUrl } from "./env";

let queryClient: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  if (!queryClient) queryClient = neon(databaseUrl());
  return queryClient;
}

export async function queryRows<T>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await getSql().query(text, params)) as T[];
}
