export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "Missing required environment variable DATABASE_URL. Add a pooled Postgres connection string in Vercel, then redeploy.",
    );
  }
  return value;
}
