import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRODUCT_EVENT_NAMES } from "./productEvents";
import { CLIENT_PRODUCT_EVENT_NAMES } from "./clientProductEvents";

// The best-effort recorder swallows insert errors, so an event name the
// database CHECK constraint does not list is silently never recorded (this
// happened to six events between migrations 035 and 043). Keep the two lists
// identical: the latest migration that declares the constraint is the truth.

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "database", "migrations");

function latestDeclaredNames(): string[] {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
  let latest: string | null = null;
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    const match = /add constraint product_events_name_check check \(name in \(([\s\S]*?)\)\)/i.exec(sql);
    if (match) latest = match[1];
  }
  if (!latest) throw new Error("no product_events_name_check declaration found");
  return [...latest.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe("product event allowlist", () => {
  it("the database accepts exactly the event names the app records", () => {
    expect(latestDeclaredNames()).toEqual([...PRODUCT_EVENT_NAMES].sort());
  });

  it("every client-sent event is one the server records", () => {
    for (const name of CLIENT_PRODUCT_EVENT_NAMES) expect(PRODUCT_EVENT_NAMES).toContain(name);
  });
});
